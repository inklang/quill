# Ink Import System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file import system to Ink so that `main.ink` serves as the single entry point and `import "./file"` resolves local `.ink` files at compile time, bundling everything into one `.inkc`.

**Architecture:** Two repos change. printing_press (Rust compiler) gains a new `ImportFile` AST node, parser branches for string literals, and an import resolver that runs between parsing and constant folding. quill (TypeScript CLI) gains an import graph discovery utility and switches from batch mode to single-entry-point compilation.

**Tech Stack:** Rust (printing_press compiler), TypeScript/Node.js (quill CLI), Vitest (quill tests)

**Spec:** `docs/superpowers/specs/2026-03-28-ink-import-system-design.md`

---

## File Structure

### printing_press (Rust) — `/c/Users/justi/dev/printing_press/`

| File | Action | Responsibility |
|---|---|---|
| `src/inklang/ast.rs` | Modify | Add `Stmt::ImportFile` variant |
| `src/inklang/parser.rs` | Modify | Add string literal branches to `parse_import()`, add `strip_quotes()` |
| `src/inklang/import_resolver.rs` | Create | `ImportResolver` struct, path resolution, cycle detection, dedup, filtering, collision check |
| `src/inklang/lowerer.rs` | Modify | Add error case for unresolved `ImportFile` |
| `src/inklang/mod.rs` | Modify | Add `compile_entry()` function |
| `src/inklang/token.rs` | Read-only | Reference for `TokenType::KwString` |
| `src/main.rs` | Modify | Add `--entry` flag, call `compile_entry` |

### quill (TypeScript) — `/c/Users/justi/dev/quill/`

| File | Action | Responsibility |
|---|---|---|
| `src/util/import-graph.ts` | Create | `discoverImportGraph()` — regex-based file discovery |
| `src/util/using-scan.ts` | Modify | No changes needed (already correct) |
| `src/commands/ink-build.ts` | Modify | Add entry-point compilation mode |
| `tests/util/import-graph.test.ts` | Create | Tests for import graph discovery |

---

## Chunk 1: printing_press — AST + Parser

### Task 1: Add `ImportFile` AST variant

**Files:**
- Modify: `printing_press/src/inklang/ast.rs:263-269`

- [ ] **Step 1: Add `ImportFile` variant to `Stmt` enum**

In `printing_press/src/inklang/ast.rs`, after the existing `ImportFrom` variant (line 266-269), add:

```rust
    /// File import: import "./utils" or import greet, Config from "./utils"
    ImportFile {
        /// The `import` keyword token (for source location in error messages)
        import_token: Token,
        /// Source file path string (quotes stripped), e.g., "./utils"
        path: String,
        /// Named items to import. None = import all. Some(vec) = selective.
        items: Option<Vec<String>>,
    },
```

- [ ] **Step 2: Add a unit test for the new variant**

In the `#[cfg(test)] mod tests` block in `ast.rs`, add:

```rust
    #[test]
    fn test_stmt_import_file() {
        let stmt = Stmt::ImportFile {
            import_token: Token {
                typ: TokenType::KwImport,
                lexeme: "import".into(),
                line: 1,
                column: 0,
            },
            path: "./utils".to_string(),
            items: None,
        };
        assert!(matches!(stmt, Stmt::ImportFile { .. }));
    }

    #[test]
    fn test_stmt_import_file_selective() {
        let stmt = Stmt::ImportFile {
            import_token: Token {
                typ: TokenType::KwImport,
                lexeme: "import".into(),
                line: 1,
                column: 0,
            },
            path: "./utils".to_string(),
            items: Some(vec!["greet".to_string(), "Config".to_string()]),
        };
        if let Stmt::ImportFile { items: Some(items), path, .. } = stmt {
            assert_eq!(path, "./utils");
            assert_eq!(items.len(), 2);
        } else {
            panic!("Expected ImportFile with items");
        }
    }
```

- [ ] **Step 3: Run tests**

Run: `cd /c/Users/justi/dev/printing_press && cargo test --lib inklang::ast`
Expected: All existing tests pass + 2 new tests pass

- [ ] **Step 4: Commit**

```bash
cd /c/Users/justi/dev/printing_press && git add src/inklang/ast.rs && git commit -m "feat(ast): add ImportFile variant for file imports"
```

### Task 2: Parse file import syntax

**Files:**
- Modify: `printing_press/src/inklang/parser.rs:726-755`

- [ ] **Step 1: Add `strip_quotes` helper**

At the end of the `impl Parser` block (before the closing `}`), add:

```rust
    /// Strip surrounding double quotes from a string literal lexeme.
    fn strip_quotes(lexeme: &str) -> String {
        lexeme.trim_start_matches('"').trim_end_matches('"').to_string()
    }
```

- [ ] **Step 2: Rewrite `parse_import` to handle string literals**

Replace the existing `parse_import` method (lines 726-755) with:

```rust
    /// Parse an import statement.
    fn parse_import(&mut self) -> Result<Stmt> {
        let import_token = self.advance(); // consume 'import'

        // Branch 1: string literal → full file import
        //   import "./utils"
        if self.check(&TokenType::KwString) {
            let path_token = self.consume(&TokenType::KwString, "Expected file path")?;
            let path = Self::strip_quotes(&path_token.lexeme);
            if self.check(&TokenType::Semicolon) { self.advance(); }
            return Ok(Stmt::ImportFile {
                import_token,
                path,
                items: None,
            });
        }

        // Branch 2: identifier(s) followed by 'from'
        if self.check(&TokenType::Identifier)
            && (self.check_ahead(1, &TokenType::KwFrom)
                || self.check_ahead(1, &TokenType::Comma))
        {
            let mut tokens = Vec::new();
            tokens.push(self.consume(&TokenType::Identifier, "Expected identifier")?);
            while self.match_token(&[TokenType::Comma]) {
                tokens.push(self.consume(&TokenType::Identifier, "Expected identifier")?);
            }
            self.consume(&TokenType::KwFrom, "Expected 'from'")?;

            // After 'from': string literal → selective file import
            if self.check(&TokenType::KwString) {
                let path_token = self.consume(&TokenType::KwString, "Expected file path")?;
                let path = Self::strip_quotes(&path_token.lexeme);
                if self.check(&TokenType::Semicolon) { self.advance(); }
                return Ok(Stmt::ImportFile {
                    import_token,
                    path,
                    items: Some(tokens.into_iter().map(|t| t.lexeme).collect()),
                });
            }

            // After 'from': identifier → package import (existing behavior)
            let namespace = self.consume(&TokenType::Identifier, "Expected namespace")?;
            if self.check(&TokenType::Semicolon) { self.advance(); }
            return Ok(Stmt::ImportFrom {
                path: vec![namespace.lexeme],
                items: tokens.into_iter().map(|t| t.lexeme).collect(),
            });
        }

        // Branch 3: bare identifier → package import (existing behavior)
        let namespace = self.consume(&TokenType::Identifier, "Expected namespace")?;
        if self.check(&TokenType::Semicolon) { self.advance(); }
        Ok(Stmt::Import(vec![namespace.lexeme]))
    }
```

- [ ] **Step 3: Add parser tests for file imports**

In the `#[cfg(test)] mod tests` block in `parser.rs`, after the existing import tests (around line 2053), add:

```rust
    #[test]
    fn test_parse_import_file() {
        let stmts = parse("import \"./utils\"");
        match &stmts[0] {
            Stmt::ImportFile { path, items, .. } => {
                assert_eq!(path, "./utils");
                assert!(items.is_none());
            }
            _ => panic!("Expected ImportFile, got {:?}", stmts[0]),
        }
    }

    #[test]
    fn test_parse_import_file_selective() {
        let stmts = parse("import greet, Config from \"./utils\"");
        match &stmts[0] {
            Stmt::ImportFile { path, items, .. } => {
                assert_eq!(path, "./utils");
                assert_eq!(items.as_ref().unwrap(), &vec!["greet".to_string(), "Config".to_string()]);
            }
            _ => panic!("Expected ImportFile with items"),
        }
    }

    #[test]
    fn test_parse_import_file_subdirectory() {
        let stmts = parse("import \"./mobs/zombie\"");
        match &stmts[0] {
            Stmt::ImportFile { path, .. } => assert_eq!(path, "./mobs/zombie"),
            _ => panic!("Expected ImportFile"),
        }
    }

    #[test]
    fn test_parse_import_file_parent_directory() {
        let stmts = parse("import \"../shared/helpers\"");
        match &stmts[0] {
            Stmt::ImportFile { path, .. } => assert_eq!(path, "../shared/helpers"),
            _ => panic!("Expected ImportFile"),
        }
    }

    #[test]
    fn test_parse_import_package_unchanged() {
        // Existing package import syntax must still work
        let stmts = parse("import math");
        assert!(matches!(&stmts[0], Stmt::Import(_)));
    }

    #[test]
    fn test_parse_import_from_package_unchanged() {
        // Existing package import-from syntax must still work
        let stmts = parse("import read, write from io");
        assert!(matches!(&stmts[0], Stmt::ImportFrom { .. }));
    }
```

- [ ] **Step 4: Run parser tests**

Run: `cd /c/Users/justi/dev/printing_press && cargo test --lib inklang::parser`
Expected: All existing tests pass + 6 new tests pass

- [ ] **Step 5: Commit**

```bash
cd /c/Users/justi/dev/printing_press && git add src/inklang/parser.rs && git commit -m "feat(parser): parse file imports with string literal paths"
```

### Task 3: Add lowerer safety net for ImportFile

**Files:**
- Modify: `printing_press/src/inklang/lowerer.rs:170-174`

- [ ] **Step 1: Add ImportFile error case to `lower_statement`**

In `lowerer.rs`, find the match arm for `Stmt::Import` (around line 173) and the `Stmt::ImportFrom` arm (line 174). After the `ImportFrom` arm, add:

**Note:** `lower_stmt` returns `()`, not `Result`, so we use `panic!` instead of `return Err`:

```rust
            Stmt::ImportFile { import_token, .. } => {
                panic!("internal error: unresolved file import at line {}", import_token.line);
            }
```

- [ ] **Step 2: Run lowerer tests**

Run: `cd /c/Users/justi/dev/printing_press && cargo test --lib inklang::lowerer`
Expected: All existing tests pass. The new branch is a safety net — it only triggers if the import resolver failed to run.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/justi/dev/printing_press && git add src/inklang/lowerer.rs && git commit -m "feat(lowerer): add safety-net error for unresolved ImportFile nodes"
```

---

## Chunk 2: printing_press — Import Resolver + Compile Entry

### Task 4: Create import resolver module

**Files:**
- Create: `printing_press/src/inklang/import_resolver.rs`
- Modify: `printing_press/src/inklang/mod.rs`

- [ ] **Step 1: Register the new module**

In `printing_press/src/inklang/mod.rs`, add after the existing `mod lowerer;` line:

```rust
pub mod import_resolver;
```

- [ ] **Step 2: Create `import_resolver.rs` with the full resolver**

Create `printing_press/src/inklang/import_resolver.rs`:

```rust
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::ast::Stmt;
use super::grammar::MergedGrammar;
use super::parser::Parser;
use super::CompileError;

/// Resolves file imports at compile time.
pub struct ImportResolver {
    /// Files currently being resolved (on the call stack) — cycle detection
    resolving: HashSet<PathBuf>,
    /// Files already fully resolved — deduplication
    resolved: HashSet<PathBuf>,
    /// Cached parsed ASTs for deduplicated imports
    cache: HashMap<PathBuf, Vec<Stmt>>,
    /// Merged grammar for parsing imported files
    grammar: Option<MergedGrammar>,
}

impl ImportResolver {
    pub fn new(grammar: Option<MergedGrammar>) -> Self {
        Self {
            resolving: HashSet::new(),
            resolved: HashSet::new(),
            cache: HashMap::new(),
            grammar,
        }
    }

    /// Resolve all file imports in the AST, returning a flat list of declarations.
    pub fn resolve(&mut self, ast: &[Stmt], base_dir: &Path) -> Result<Vec<Stmt>, CompileError> {
        let mut result = Vec::new();

        for stmt in ast {
            match stmt {
                Stmt::ImportFile { import_token, path, items } => {
                    let target = resolve_path(base_dir, path, import_token.line)?;
                    let canonical = target.canonicalize()
                        .map_err(|_| CompileError::Other(
                            format!("import error at line {}: file not found: {}", import_token.line, path)))?;

                    // Cycle detection
                    if self.resolving.contains(&canonical) {
                        return Err(CompileError::Other(
                            format!("circular import detected at line {}: '{}' is already being imported",
                                import_token.line, path)));
                    }

                    // Deduplication — reuse cached declarations
                    if self.resolved.contains(&canonical) {
                        let cached = self.cache.get(&canonical).unwrap();
                        let filtered = match items {
                            Some(names) => filter_declarations(cached, names, path, import_token.line)?,
                            None => cached.clone(),
                        };
                        result.extend(filtered);
                        continue;
                    }

                    // Mark as resolving
                    self.resolving.insert(canonical.clone());

                    // Read and parse target file
                    let source = std::fs::read_to_string(&target)
                        .map_err(|e| CompileError::Other(
                            format!("import error at line {}: could not read '{}': {}",
                                import_token.line, target.display(), e)))?;

                    let tokens = super::lexer::tokenize(&source);
                    let target_ast = Parser::new(tokens, self.grammar.as_ref())
                        .parse()
                        .map_err(|e| CompileError::Other(
                            format!("import error at line {}: parse error in '{}': {}",
                                import_token.line, path, e)))?;

                    // Recursively resolve target's imports
                    let target_dir = target.parent().unwrap_or(base_dir).to_path_buf();
                    let mut target_resolved = self.resolve(&target_ast, &target_dir)?;

                    // Cache before filtering
                    self.cache.insert(canonical.clone(), target_resolved.clone());

                    // Mark as resolved
                    self.resolving.remove(&canonical);
                    self.resolved.insert(canonical);

                    // Apply selective filter
                    if let Some(names) = items {
                        target_resolved = filter_declarations(&target_resolved, names, path, import_token.line)?;
                    }

                    result.extend(target_resolved);
                }
                other => result.push(other.clone()),
            }
        }

        Ok(result)
    }
}

/// Resolve an import path to a filesystem path.
fn resolve_path(base_dir: &Path, import_path: &str, line: usize) -> Result<PathBuf, CompileError> {
    if !import_path.starts_with("./") && !import_path.starts_with("../") {
        return Err(CompileError::Other(
            format!("import error at line {}: path must start with './' or '../' — bare names are for packages (got '{}')",
                line, import_path)));
    }

    let target = base_dir.join(import_path);
    let target = if target.extension().is_none() {
        target.with_extension("ink")
    } else {
        target
    };

    if !target.exists() {
        return Err(CompileError::Other(
            format!("import error at line {}: file not found: {}", line, target.display())));
    }

    Ok(target)
}

/// Extract the name of an importable declaration, if it has one.
fn declaration_name(stmt: &Stmt) -> Option<&str> {
    match stmt {
        Stmt::Fn { name, .. } => Some(&name.lexeme),
        Stmt::Let { name, .. } => Some(&name.lexeme),
        Stmt::Const { name, .. } => Some(&name.lexeme),
        Stmt::Class { name, .. } => Some(&name.lexeme),
        Stmt::Enum { name, .. } => Some(&name.lexeme),
        Stmt::GrammarDecl { name, .. } => Some(name),
        Stmt::Config { name, .. } => Some(&name.lexeme),
        Stmt::Table { name, .. } => Some(&name.lexeme),
        Stmt::AnnotationDef { name, .. } => Some(&name.lexeme),
        Stmt::EventDecl { name, .. } => Some(&name.lexeme),
        _ => None,
    }
}

/// Filter declarations to only include named items for selective imports.
fn filter_declarations(
    stmts: &[Stmt],
    names: &[String],
    path: &str,
    line: usize,
) -> Result<Vec<Stmt>, CompileError> {
    let mut result = Vec::new();
    let mut found = HashSet::new();

    for stmt in stmts {
        if let Some(name) = declaration_name(stmt) {
            if names.iter().any(|n| n == name) {
                result.push(stmt.clone());
                found.insert(name.to_string());
            }
        }
    }

    let missing: Vec<&String> = names.iter().filter(|n| !found.contains(**n)).collect();
    if !missing.is_empty() {
        return Err(CompileError::Other(
            format!("import error at line {}: not found in '{}': {}",
                line, path, missing.iter().map(|s| format!("'{}'", s)).join(", "))));
    }

    Ok(result)
}

/// Check for name collisions across all top-level declarations.
pub fn check_name_collisions(stmts: &[Stmt], source_name: &str) -> Result<(), CompileError> {
    let mut seen: HashMap<String, String> = HashMap::new(); // name → source indicator

    for stmt in stmts {
        if let Some(name) = declaration_name(stmt) {
            if let Some(_prev) = seen.get(name) {
                return Err(CompileError::Other(
                    format!("duplicate declaration '{}': defined multiple times in merged module",
                        name)));
            }
            seen.insert(name.to_string(), source_name.to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn stmts_with_names(names: &[&str]) -> Vec<Stmt> {
        // Create minimal Stmt::Fn nodes for testing name extraction
        names.iter().map(|name| {
            Stmt::Fn {
                annotations: vec![],
                name: super::super::token::Token {
                    typ: super::super::token::TokenType::Identifier,
                    lexeme: name.to_string(),
                    line: 1,
                    column: 0,
                },
                params: vec![],
                return_type: None,
                body: Box::new(Stmt::Block(vec![])),
                is_async: false,
            }
        }).collect()
    }

    #[test]
    fn test_filter_declarations_finds_all() {
        let stmts = stmts_with_names(&["greet", "farewell", "Config"]);
        let result = filter_declarations(&stmts, &["greet".to_string(), "Config".to_string()], "./utils", 1).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_filter_declarations_missing_name() {
        let stmts = stmts_with_names(&["greet"]);
        let result = filter_declarations(&stmts, &["nonexistent".to_string()], "./utils", 1);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[test]
    fn test_check_name_collisions_ok() {
        let stmts = stmts_with_names(&["greet", "farewell"]);
        assert!(check_name_collisions(&stmts, "main").is_ok());
    }

    #[test]
    fn test_check_name_collisions_duplicate() {
        let stmts = stmts_with_names(&["greet", "greet"]);
        let result = check_name_collisions(&stmts, "main");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("duplicate"));
    }

    #[test]
    fn test_resolve_path_valid() {
        let dir = std::env::temp_dir();
        let file_path = dir.join("test_import.ink");
        fs::write(&file_path, "").unwrap();
        let result = resolve_path(&dir, "./test_import", 1);
        fs::remove_file(&file_path).ok();
        assert!(result.is_ok());
    }

    #[test]
    fn test_resolve_path_not_found() {
        let result = resolve_path(Path::new("/nonexistent"), "./missing", 1);
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_path_bare_name_rejected() {
        let result = resolve_path(Path::new("."), "math", 1);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("must start with"));
    }

    #[test]
    fn test_resolve_path_parent_dir_allowed() {
        let dir = std::env::temp_dir();
        let subdir = dir.join("sub");
        fs::create_dir_all(&subdir).unwrap();
        let file_path = dir.join("parent_import.ink");
        fs::write(&file_path, "").unwrap();
        let result = resolve_path(&subdir, "../parent_import", 1);
        fs::remove_file(&file_path).ok();
        fs::remove_dir(&subdir).ok();
        assert!(result.is_ok());
    }
}
```

- [ ] **Step 3: Run import resolver tests**

Run: `cd /c/Users/justi/dev/printing_press && cargo test --lib inklang::import_resolver`
Expected: 8 tests pass

- [ ] **Step 4: Commit**

```bash
cd /c/Users/justi/dev/printing_press && git add src/inklang/import_resolver.rs src/inklang/mod.rs && git commit -m "feat: add import resolver with cycle detection and deduplication"
```

### Task 5: Add `compile_entry` function

**Files:**
- Modify: `printing_press/src/inklang/mod.rs:46-132`

- [ ] **Step 1: Add `compile_entry` function**

In `printing_press/src/inklang/mod.rs`, add after the existing `compile_with_grammar` function (after line 132):

```rust
/// Compile an entry point file with import resolution.
/// Resolves all `import "./file"` statements transitively,
/// merges declarations, and produces a single `.inkc`.
pub fn compile_entry(
    entry_path: &Path,
    grammar: Option<&MergedGrammar>,
) -> Result<SerialScript, CompileError> {
    use std::path::Path;

    let source = std::fs::read_to_string(entry_path)
        .map_err(|e| CompileError::Other(
            format!("could not read '{}': {}", entry_path.display(), e)))?;
    let name = entry_path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("main");

    // 1. Tokenize
    let tokens = lexer::tokenize(&source);

    // 2. Parse
    let ast = Parser::new(tokens, grammar)
        .parse()
        .map_err(|e| CompileError::Other(format!("parse error in '{}': {}", entry_path.display(), e)))?;

    // 3. Resolve file imports
    let base_dir = entry_path.parent().unwrap_or(Path::new("."));
    let mut resolver = import_resolver::ImportResolver::new(grammar.cloned());
    let resolved_ast = resolver.resolve(&ast, base_dir)?;

    // 4. Name collision check
    import_resolver::check_name_collisions(&resolved_ast, name)?;

    // 5. Constant fold
    let folded = ConstantFolder::new().fold(&resolved_ast);

    // 6. Lower to IR
    let lowered = AstLowerer::new().lower(&folded);

    // 7-9. SSA → RegAlloc → Peephole → Codegen → Serialize
    let ssa_result = ssa::optimized_ssa_round_trip(
        lowered.instrs,
        lowered.constants,
        lowered.arity,
    );

    let ranges = LivenessAnalyzer::new().analyze(&ssa_result.instrs);
    let mut allocator = RegisterAllocator::new();
    let alloc = allocator.allocate(&ranges, lowered.arity);
    let resolved = SpillInserter::new().insert(ssa_result.instrs, &alloc, &ranges);
    let resolved = peephole::run(resolved);

    let codegen_result = codegen::LoweredResult {
        instrs: resolved,
        constants: ssa_result.constants,
        arity: lowered.arity,
    };
    let mut compiler = IrCompiler::new();
    let chunk = compiler.compile(codegen_result);

    Ok(SerialScript::from_chunk(name, &chunk))
}
```

Also add `use std::path::Path;` import at the top of the file if not already present.

- [ ] **Step 2: Run full test suite**

Run: `cd /c/Users/justi/dev/printing_press && cargo test`
Expected: All existing tests pass + new import resolver tests pass

- [ ] **Step 3: Commit**

```bash
cd /c/Users/justi/dev/printing_press && git add src/inklang/mod.rs && git commit -m "feat: add compile_entry function for import-aware compilation"
```

### Task 6: Add `--entry` CLI flag

**Files:**
- Modify: `printing_press/src/main.rs:42-68`

- [ ] **Step 1: Add `--entry` flag to CLI**

In `printing_press/src/main.rs`, add a new flag to `CompileArgs` (after the `debug` flag around line 39):

```rust
    /// Compile a single entry point with import resolution
    #[arg(long)]
    entry: bool,
```

- [ ] **Step 2: Wire up `--entry` in the compile handler**

In the `Command::Compile(c)` match arm, after the single-file mode block (around line 67), add the `--entry` check:

```rust
            // Determine mode: if --sources provided, batch mode
            if let Some(sources_dir) = c.sources {
                let out_dir = c.out.expect("--out is required in batch mode");
                batch_compile(&sources_dir, &out_dir, grammar.as_ref(), c.debug);
            } else if c.entry {
                // Entry-point mode with import resolution
                let input = c.input.expect("INPUT file required with --entry");
                let output = c.output.expect("-o/--output required with --entry");
                entry_compile(&input, &output, grammar.as_ref(), c.debug);
            } else {
                // Single-file mode (legacy, no import resolution)
                let input = c.input.expect("INPUT file or --sources required");
                let output = c.output.expect("-o/--output required in single-file mode");
                single_compile(&input, &output, grammar.as_ref(), c.debug);
            }
```

- [ ] **Step 3: Add `entry_compile` function**

Add this new function after `single_compile`:

```rust
fn entry_compile(input: &str, output: &str, grammar: Option<&printing_press::inklang::grammar::MergedGrammar>, debug: bool) {
    let entry_path = std::path::Path::new(input);
    match printing_press::compile_entry(entry_path, grammar) {
        Ok(script) => {
            let json = if debug {
                serde_json::to_string_pretty(&script).unwrap()
            } else {
                serde_json::to_string(&script).unwrap()
            };
            std::fs::write(output, json).unwrap();
            println!("Compiled {} → {} (with imports)", input, output);
        }
        Err(e) => {
            eprintln!("error: compilation failed: {}", e);
            std::process::exit(1);
        }
    }
}
```

- [ ] **Step 4: Run cargo test and verify CLI**

Run: `cd /c/Users/justi/dev/printing_press && cargo test && cargo run -- compile --help`
Expected: Tests pass. Help text shows `--entry` flag.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/justi/dev/printing_press && git add src/main.rs && git commit -m "feat(cli): add --entry flag for import-aware compilation"
```

---

## Chunk 3: quill — Import Graph Discovery + Build Integration

### Task 7: Create import graph discovery utility

**Files:**
- Create: `quill/src/util/import-graph.ts`
- Create: `quill/tests/util/import-graph.test.ts`

- [ ] **Step 1: Create `import-graph.ts`**

Create `quill/src/util/import-graph.ts`:

```typescript
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname, extname } from 'path'

/**
 * Discover all .ink files reachable from an entry point via `import "./..."` statements.
 * Uses regex-based scanning (not a full parser) to find import paths before compilation.
 */
export function discoverImportGraph(entryPoint: string): string[] {
  const visited = new Set<string>()
  const files: string[] = []
  const queue = [resolve(entryPoint)]

  while (queue.length > 0) {
    const filePath = queue.shift()!
    const canonical = resolve(filePath)

    if (visited.has(canonical)) continue
    visited.add(canonical)

    if (!existsSync(canonical)) continue

    const source = readFileSync(canonical, 'utf-8')
    files.push(canonical)

    // Match file import paths: import "./path" and import x, y from "./path"
    // Also matches "../path" for parent directory imports
    const importRegex = /import\s+(?:\w+(?:\s*,\s*\w+)*\s+from\s+)?["'](\.\.?\/[^"']+)["']/g
    let match
    while ((match = importRegex.exec(source)) !== null) {
      const importPath = match[1]
      const targetBase = importPath.endsWith('.ink') ? importPath : importPath + '.ink'
      const resolved = resolve(dirname(canonical), targetBase)
      if (!visited.has(resolved)) {
        queue.push(resolved)
      }
    }
  }

  return files
}
```

- [ ] **Step 2: Create test file**

Create `quill/tests/util/import-graph.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { discoverImportGraph } from '../../src/util/import-graph.js'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const FIXTURE_DIR = join(tmpdir(), 'ink-import-graph-test')

beforeEach(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
})

describe('discoverImportGraph', () => {
  it('returns just the entry point when no imports', () => {
    const main = join(FIXTURE_DIR, 'main.ink')
    writeFileSync(main, 'print("hello")')
    const result = discoverImportGraph(main)
    expect(result).toEqual([main])
  })

  it('follows a single import', () => {
    const main = join(FIXTURE_DIR, 'main.ink')
    const utils = join(FIXTURE_DIR, 'utils.ink')
    writeFileSync(main, 'import "./utils"\nprint("hello")')
    writeFileSync(utils, 'fn greet() { print("hi") }')
    const result = discoverImportGraph(main)
    expect(result).toHaveLength(2)
    expect(result).toContain(main)
    expect(result).toContain(utils)
  })

  it('follows selective imports', () => {
    const main = join(FIXTURE_DIR, 'main.ink')
    const utils = join(FIXTURE_DIR, 'utils.ink')
    writeFileSync(main, 'import greet, Config from "./utils"')
    writeFileSync(utils, 'fn greet() {}')
    const result = discoverImportGraph(main)
    expect(result).toHaveLength(2)
    expect(result).toContain(utils)
  })

  it('deduplicates diamond imports', () => {
    const main = join(FIXTURE_DIR, 'main.ink')
    const a = join(FIXTURE_DIR, 'a.ink')
    const b = join(FIXTURE_DIR, 'b.ink')
    const shared = join(FIXTURE_DIR, 'shared.ink')
    writeFileSync(main, 'import "./a"\nimport "./b"')
    writeFileSync(a, 'import "./shared"')
    writeFileSync(b, 'import "./shared"')
    writeFileSync(shared, 'fn helper() {}')
    const result = discoverImportGraph(main)
    expect(result).toHaveLength(4)
    expect(result).toContain(shared)
  })

  it('follows subdirectory imports', () => {
    const subDir = join(FIXTURE_DIR, 'mobs')
    mkdirSync(subDir, { recursive: true })
    const main = join(FIXTURE_DIR, 'main.ink')
    const zombie = join(subDir, 'zombie.ink')
    writeFileSync(main, 'import "./mobs/zombie"')
    writeFileSync(zombie, 'fn brains() {}')
    const result = discoverImportGraph(main)
    expect(result).toHaveLength(2)
    expect(result).toContain(zombie)
  })

  it('skips missing files gracefully', () => {
    const main = join(FIXTURE_DIR, 'main.ink')
    writeFileSync(main, 'import "./nonexistent"')
    const result = discoverImportGraph(main)
    expect(result).toEqual([main])
  })

  it('follows parent directory imports', () => {
    const subDir = join(FIXTURE_DIR, 'sub')
    mkdirSync(subDir, { recursive: true })
    const main = join(subDir, 'main.ink')
    const shared = join(FIXTURE_DIR, 'shared.ink')
    writeFileSync(main, 'import "../shared"')
    writeFileSync(shared, 'fn helper() {}')
    const result = discoverImportGraph(main)
    expect(result).toHaveLength(2)
    expect(result).toContain(shared)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `cd /c/Users/justi/dev/quill && npx vitest run tests/util/import-graph.test.ts`
Expected: 6 tests pass

- [ ] **Step 4: Commit**

```bash
cd /c/Users/justi/dev/quill && git add src/util/import-graph.ts tests/util/import-graph.test.ts && git commit -m "feat: add discoverImportGraph utility for file import scanning"
```

### Task 8: Wire entry-point compilation into ink-build

**Files:**
- Modify: `quill/src/commands/ink-build.ts`

This is the most sensitive change. The existing build flow is:
1. Scan all `.ink` files in `scripts/`
2. For each file, invoke `printing_press compile --sources DIR --out DIR` (batch) or per-file (incremental)

The new flow is:
1. Determine entry point from `ink-package.toml` `main` field (default: `scripts/main.ink`)
2. Discover all files via `discoverImportGraph`
3. Scan all discovered files for `using` declarations
4. Invoke `printing_press compile scripts/main.ink --entry -o dist/scripts/main.inkc --grammar ...`
5. Output a single `.inkc`

- [ ] **Step 1: Add import to ink-build.ts**

At the top of `ink-build.ts`, add:

```typescript
import { discoverImportGraph } from '../util/import-graph.js'
```

- [ ] **Step 2: Add `compileEntryPoint` method**

Add this private method to `InkBuildCommand`:

```typescript
  /**
   * Compile using a single entry point with import resolution.
   * The compiler resolves all `import "./file"` statements transitively.
   */
  private compileEntryPoint(
    compiler: string,
    entryFile: string,
    outDir: string,
    grammarIrPath?: string
  ): void {
    const isNative = /\.(exe|bat|cmd|sh)$/.test(compiler) || compiler.includes('printing_press');
    const compilerPath = compiler.replace(/\\/g, '/');
    const entryFwd = entryFile.replace(/\\/g, '/');
    const outputPath = join(outDir, 'main.inkc').replace(/\\/g, '/');

    if (isNative) {
      const grammarFlag = grammarIrPath
        ? `--grammar "${grammarIrPath.replace(/\\/g, '/')}" `
        : '';
      try {
        const output = execSync(
          `"${compilerPath}" compile ${grammarFlag}--entry "${entryFwd}" -o "${outputPath}"`,
          { cwd: this.projectDir, stdio: 'pipe' } as any
        )?.toString() ?? '';
        if (output) console.log(output.trim());
      } catch (e: any) {
        const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
        console.error('Ink compilation failed:\n' + output);
        process.exit(1);
      }
    } else {
      // Java JAR mode
      const javaCmd = (process.env['INK_JAVA'] || 'java').replace(/\\/g, '/');
      const grammarFlag = grammarIrPath
        ? `--grammar "${grammarIrPath.replace(/\\/g, '/')}" `
        : '';
      try {
        execSync(
          `"${javaCmd}" -jar "${compilerPath}" compile ${grammarFlag}--entry "${entryFwd}" -o "${outputPath}"`,
          { cwd: this.projectDir, stdio: 'pipe' } as any
        );
      } catch (e: any) {
        const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
        console.error('Ink compilation failed:\n' + output);
        process.exit(1);
      }
    }
  }
```

- [ ] **Step 3: Add entry-point build flow to `run()` method**

In the `run()` method, find the scripts compilation section (around line 150-264). After the existing `using` scanning logic and before the `if (opts.full)` branch, add the entry-point detection logic.

Find the block starting with:
```typescript
    // Scripts compilation with incremental build support
    const scriptsDir = join(this.projectDir, 'scripts');
```

After the `resolveAndMergeGrammars` call (line 175), and before the `if (opts.full)` check (line 178), insert:

```typescript
        // Entry-point mode: if main.ink exists, compile with import resolution
        const mainScript = manifest.main ?? 'scripts/main.ink';
        const entryPointPath = join(this.projectDir, mainScript);
        if (existsSync(entryPointPath)) {
          console.log(`Compiling from entry point: ${mainScript}`);

          // Discover all files reachable via imports for using-scanning
          const allFiles = discoverImportGraph(entryPointPath);

          // Re-scan grammar using all discovered files
          if (existsSync(grammarIrPath) && allFiles.length > 0) {
            await this.resolveAndMergeGrammars(allFiles, grammarIrPath);
          }

          this.compileEntryPoint(compiler, entryPointPath, outDir, existsSync(grammarIrPath) ? grammarIrPath : undefined);

          inkManifest.scripts = ['main.inkc'];
        } else if (opts.full) {
          // ...existing full rebuild code...
```

Note: This wraps the existing batch/incremental logic in an `else` branch, keeping backward compatibility for projects without `main.ink`.

- [ ] **Step 4: Run quill tests**

Run: `cd /c/Users/justi/dev/quill && npx vitest run`
Expected: All existing tests pass. The new entry-point mode only activates when `main.ink` exists.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/justi/dev/quill && git add src/commands/ink-build.ts && git commit -m "feat(ink-build): add entry-point compilation mode with import resolution"
```

---

## Chunk 4: End-to-End Integration Test

### Task 9: Create end-to-end test fixture

**Files:**
- Create: `quill/tests/fixtures/import-project/scripts/main.ink`
- Create: `quill/tests/fixtures/import-project/scripts/utils.ink`
- Create: `quill/tests/fixtures/import-project/scripts/mobs/zombie.ink`
- Create: `quill/tests/fixtures/import-project/ink-package.toml`
- Create: `quill/tests/commands/ink-build-import.test.ts`

- [ ] **Step 1: Create test fixture files**

Create `quill/tests/fixtures/import-project/ink-package.toml`:
```toml
[package]
name = "import-test"
version = "0.1.0"
main = "scripts/main.ink"
```

Create `quill/tests/fixtures/import-project/scripts/utils.ink`:
```ink
fn greet(name) {
  print("Hello, " + name + "!")
}

const VERSION = "1.0"
```

Create `quill/tests/fixtures/import-project/scripts/mobs/zombie.ink`:
```ink
fn brains() {
  print("BRAINS!")
}
```

Create `quill/tests/fixtures/import-project/scripts/main.ink`:
```ink
import "./utils"
import brains from "./mobs/zombie"

greet("World")
brains()
```

- [ ] **Step 2: Create test file**

Create `quill/tests/commands/ink-build-import.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { InkBuildCommand } from '../../src/commands/ink-build.js'
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const FIXTURE_DIR = join(tmpdir(), 'ink-import-e2e-test')

describe('ink-build import resolution', () => {
  beforeEach(() => {
    mkdirSync(FIXTURE_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  })

  it('compiles entry point with imports into single inkc', async () => {
    // Copy fixture to temp dir to avoid polluting the fixture
    const srcDir = join(process.cwd(), 'tests', 'fixtures', 'import-project')
    if (!existsSync(srcDir)) {
      // Fixture not yet created — skip
      return
    }

    // TODO: implement test that:
    // 1. Copies fixture to temp dir
    // 2. Runs InkBuildCommand
    // 3. Verifies dist/scripts/main.inkc exists
    // 4. Verifies it's valid JSON
    // 5. Verifies it contains functions from all imported files
    expect(true).toBe(true)
  })
})
```

Note: The full E2E test requires the updated printing_press binary to be available. This test will be filled in after both repos are built. The placeholder ensures the test infrastructure is in place.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/justi/dev/quill && git add tests/fixtures/import-project/ tests/commands/ink-build-import.test.ts && git commit -m "test: add import resolution integration test fixture"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `cd /c/Users/justi/dev/printing_press && cargo test` — all tests pass
- [ ] `cd /c/Users/justi/dev/quill && npx vitest run` — all tests pass
- [ ] `cd /c/Users/justi/dev/printing_press && cargo build --release` — binary compiles
- [ ] Manual test: create a project with `main.ink` importing `./utils`, run `quill build`, verify single `.inkc` output contains functions from both files
