pub mod error;
pub mod token;
pub mod lexer;
pub mod ast;
pub mod value;
pub mod parser;
pub mod constant_fold;
pub mod lowerer;
pub mod ir;
pub mod ssa;
pub mod liveness;
pub mod register_alloc;
pub mod spill_insert;
pub mod codegen;
pub mod peephole;
pub mod chunk;
pub mod serialize;
pub mod grammar;
pub mod import_resolver;

pub use serialize::{SerialScript, SerialChunk, SerialValue, SerialConfigField};

use codegen::IrCompiler;
use constant_fold::ConstantFolder;
use error::Span;
use grammar::MergedGrammar;
use liveness::LivenessAnalyzer;
use lowerer::AstLowerer;
use parser::Parser;
use register_alloc::RegisterAllocator;
use spill_insert::SpillInserter;
use ir::IrInstr;
use thiserror::Error;
use value::Value;

/// Run IR-level optimization passes (SSA → liveness → regalloc → spill → peephole)
/// on a standalone instruction sequence with its own register space.
pub fn optimize_ir(instrs: Vec<IrInstr>, constants: Vec<Value>, arity: usize) -> (Vec<IrInstr>, Vec<Value>) {
    let ssa_result = ssa::optimized_ssa_round_trip(instrs, constants, arity);
    let ranges = LivenessAnalyzer::new().analyze(&ssa_result.instrs);
    let mut allocator = RegisterAllocator::new();
    let alloc = allocator.allocate(&ranges, arity);
    let resolved = SpillInserter::new().insert(ssa_result.instrs, &alloc, &ranges);
    let resolved = peephole::run(resolved);
    (resolved, ssa_result.constants)
}

/// Compile error types.
#[derive(Debug, Error)]
pub enum CompileError {
    #[error("{message}")]
    Parsing {
        message: String,
        span: Span,
        source_lines: Vec<String>,
    },
    #[error("{0}")]
    Other(String),
}

impl CompileError {
    /// Render the error with source context (line + caret).
    pub fn display(&self) -> String {
        match self {
            CompileError::Parsing { message, span, source_lines } => {
                let mut out = format!("error: {}", message);
                let line_idx = span.line.saturating_sub(1);
                if let Some(source_line) = source_lines.get(line_idx) {
                    let line_num_width = format!("{}", span.line).len();
                    out.push_str(&format!(
                        "\n  {:>width$} | {}",
                        span.line,
                        source_line,
                        width = line_num_width,
                    ));
                    out.push_str(&format!(
                        "\n  {:>width$} | {}^",
                        "",
                        " ".repeat(span.column.saturating_sub(1)),
                        width = line_num_width,
                    ));
                }
                out
            }
            CompileError::Other(msg) => format!("error: {}", msg),
        }
    }
}

/// Compile Inklang source code to a SerialScript (JSON).
/// Grammar is auto-discovered from dist/ and packages/*/dist/.
///
/// # Pipeline
/// 1. Tokenize → 2. Parse (auto-grammar) → 3. Constant Fold → 4. Lower to IR → 5. SSA Round-trip → 6. Register Alloc → 6b. Peephole → 7. Codegen → 8. Serialize
pub fn compile(source: &str, name: &str) -> Result<SerialScript, CompileError> {
    let grammar = auto_discover_grammar();
    compile_with_grammar(source, name, grammar.as_ref())
}

/// Auto-discover grammar files from the project convention:
/// - dist/grammar.ir.json         (current package)
/// - packages/*/dist/grammar.ir.json  (installed packages)
fn auto_discover_grammar() -> Option<MergedGrammar> {
    use std::fs;

    let mut packages: Vec<grammar::GrammarPackage> = Vec::new();

    // Load dist/grammar.ir.json (current package)
    if let Ok(pkg) = grammar::load_grammar("dist/grammar.ir.json") {
        packages.push(pkg);
    }

    // Scan packages/*/dist/grammar.ir.json (installed packages)
    if let Ok(entries) = fs::read_dir("packages") {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let grammar_path = path.join("dist/grammar.ir.json");
                if let Ok(pkg) = grammar::load_grammar(grammar_path.to_str().unwrap_or("")) {
                    packages.push(pkg);
                }
            }
        }
    }

    if packages.is_empty() {
        None
    } else {
        Some(grammar::merge_grammars(packages))
    }
}

/// Compile Inklang source code with a grammar to a SerialScript (JSON).
///
/// # Pipeline
/// 1. Tokenize → 2. Parse (with grammar) → 3. Constant Fold → 4. Lower to IR → 5. SSA Round-trip → 6. Register Alloc → 6b. Peephole → 7. Codegen → 8. Serialize
pub fn compile_with_grammar(source: &str, name: &str, grammar: Option<&MergedGrammar>) -> Result<SerialScript, CompileError> {
    // 1. Tokenize
    let tokens = lexer::tokenize(source);

    // Store source lines for error rendering
    let source_lines: Vec<String> = source.lines().map(|l| l.to_string()).collect();

    // 2. Parse
    let ast = Parser::new(tokens, grammar)
        .parse()
        .map_err(|e| {
            let span = e.span().unwrap_or(Span { line: 1, column: 1 });
            CompileError::Parsing {
                message: e.to_string(),
                span,
                source_lines,
            }
        })?;

    // 3. Constant fold
    let folded = ConstantFolder::new().fold(&ast);

    // 4. Lower to IR
    let lowered = AstLowerer::new().lower(&folded);

    // 5-6b. Optimize IR (SSA → liveness → regalloc → spill → peephole)
    let (resolved, constants) = optimize_ir(lowered.instrs, lowered.constants, lowered.arity);

    // 7. Codegen
    let codegen_result = codegen::LoweredResult {
        instrs: resolved,
        constants,
        arity: lowered.arity,
    };
    let mut compiler = IrCompiler::new();
    let chunk = compiler.compile(codegen_result);

    // 8. Serialize
    Ok(SerialScript::from_chunk(name, &chunk))
}

/// Compile an entry point file with import resolution.
pub fn compile_entry(
    entry_path: &std::path::Path,
    grammar: Option<&MergedGrammar>,
) -> Result<SerialScript, CompileError> {
    let source = std::fs::read_to_string(entry_path)
        .map_err(|e| CompileError::Other(
            format!("could not read '{}': {}", entry_path.display(), e)))?;
    let name = entry_path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("main");

    let tokens = lexer::tokenize(&source);
    let source_lines: Vec<String> = source.lines().map(|l| l.to_string()).collect();

    let ast = Parser::new(tokens, grammar)
        .parse()
        .map_err(|e| {
            let span = e.span().unwrap_or(Span { line: 1, column: 1 });
            CompileError::Parsing {
                message: e.to_string(),
                span,
                source_lines,
            }
        })?;

    let base_dir = entry_path.parent().unwrap_or(std::path::Path::new("."));
    let mut resolver = import_resolver::ImportResolver::new(grammar.cloned());
    let resolved_ast = resolver.resolve(&ast, base_dir)?;

    import_resolver::check_name_collisions(&resolved_ast, name)?;

    let folded = ConstantFolder::new().fold(&resolved_ast);
    let lowered = AstLowerer::new().lower(&folded);
    let (resolved, constants) = optimize_ir(lowered.instrs, lowered.constants, lowered.arity);

    let codegen_result = codegen::LoweredResult {
        instrs: resolved,
        constants,
        arity: lowered.arity,
    };
    let mut compiler = IrCompiler::new();
    let chunk = compiler.compile(codegen_result);

    Ok(SerialScript::from_chunk(name, &chunk))
}

/// Parse an entry point file and resolve all file imports, returning the merged AST.
/// Stops before lowering — useful for export collection and static analysis.
pub fn resolve_ast(
    entry_path: &std::path::Path,
    grammar: Option<&MergedGrammar>,
) -> Result<Vec<ast::Stmt>, CompileError> {
    let source = std::fs::read_to_string(entry_path)
        .map_err(|e| CompileError::Other(
            format!("could not read '{}': {}", entry_path.display(), e)))?;

    let tokens = lexer::tokenize(&source);
    let source_lines: Vec<String> = source.lines().map(|l| l.to_string()).collect();

    let parsed = Parser::new(tokens, grammar)
        .parse()
        .map_err(|e| {
            let span = e.span().unwrap_or(Span { line: 1, column: 1 });
            CompileError::Parsing {
                message: e.to_string(),
                span,
                source_lines,
            }
        })?;

    let base_dir = entry_path.parent().unwrap_or(std::path::Path::new("."));
    let mut resolver = import_resolver::ImportResolver::new(grammar.cloned());
    resolver.resolve(&parsed, base_dir)
}
