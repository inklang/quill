# Ink Import System Design

## Problem

Currently every `.ink` file in `scripts/` is compiled independently to its own `.inkc` and loaded as a separate plugin with its own VM. Scripts can't share state, globals, or declarations. The `using` keyword is a quill-level hack (TypeScript scanner) that only resolves grammar packages — it's not a real language feature.

The compiler (printing_press) already parses `import` statements into the AST but emits placeholder markers (`__import__module`) that the runtime never resolves.

## Solution

Add a file import system to Ink. A single entry point (`main.ink`) is compiled, and the compiler resolves file imports transitively, merging all declarations into a single `.inkc`. File imports use string literal paths to distinguish from the existing identifier-based package imports.

## Syntax

```ink
// File imports — string literal path signals a local file
import "./utils"
import greet, Config from "./utils"
import "./mobs/zombie"
import "../shared/helpers"         // parent directory allowed within project root

// Package/stdlib imports — identifier (existing behavior, unchanged)
import math
import read, write from io
```

Rules:
- **String literal after `import`** = local `.ink` file import (new)
- **Identifier after `import`** = package/stdlib import (existing, unchanged)
- **No `export` keyword** — all top-level declarations are implicitly importable
- **`using`** remains for grammar packages (resolved by quill, not the compiler)

### Why string literals

The existing parser expects identifiers after `import`. Using string literals for file paths:
1. Distinguishes file imports from package imports at the lexer level
2. Matches developer intuition (JS/TS/Python all use strings for file paths)
3. Requires minimal parser changes — add a string literal branch to `parse_import()`

### Why `import x, y from "path"` instead of `import { x, y } from "path"`

The parser already supports the `import X, Y from Z` pattern (it parses identifiers followed by `from`). Adding braces syntax would require new token handling. Reusing the existing `from` keyword minimizes parser changes while remaining intuitive.

## Entry Point

`main.ink` in the `scripts/` directory is the entry point by convention. Overridable in `ink-package.toml`:

```toml
[package]
name = "my-plugin"
version = "0.1.0"
main = "scripts/main.ink"   # optional, defaults to scripts/main.ink
```

Only the entry point file is passed to the compiler. Other files are only compiled if imported.

## AST Changes

### New AST node

Add `ImportFile` variant to `Stmt` enum in `printing_press/src/inklang/ast.rs`:

```rust
/// File import: import "./utils" or import greet, Config from "./utils"
ImportFile {
    /// The import keyword token (for source location in error messages)
    import_token: Token,
    /// Source file path string (e.g., "./utils"), with quotes stripped
    path: String,
    /// Named items to import. None = import all. Some(vec) = selective.
    items: Option<Vec<String>>,
}
```

Using `Token` (not raw `line: usize`) for the source location is consistent with other AST nodes that store `Token` for name, keyword, etc. The `Token` struct carries `line`, `column`, and `lexeme`.

### Existing nodes (unchanged)

These continue to handle package/stdlib imports:

```rust
/// Package import: import math
Import(Vec<String>),

/// Package import from: import read, write from io
ImportFrom {
    path: Vec<String>,
    items: Vec<String>,
}
```

## Parser Changes

Modify `parse_import()` in `printing_press/src/inklang/parser.rs` to detect string literals. The lexer tokenizes `"./utils"` as a `KwString` token. The token's lexeme includes the surrounding double quotes (`"./utils"`). The parser must strip them.

```rust
fn parse_import(&mut self) -> Result<Stmt> {
    let import_token = self.advance(); // consume 'import'

    // Branch 1: string literal → full file import
    //    import "./utils"
    if self.check(&TokenType::KwString) {
        let path_token = self.consume(&TokenType::KwString, "Expected file path")?;
        let path = strip_quotes(&path_token.lexeme);
        if self.check(&TokenType::Semicolon) { self.advance(); }
        return Ok(Stmt::ImportFile {
            import_token,
            path,
            items: None,
        });
    }

    // Branch 2: identifier followed by 'from' or comma → could be selective import
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
            let path = strip_quotes(&path_token.lexeme);
            if self.check(&TokenType::Semicolon) { self.advance(); }
            return Ok(Stmt::ImportFile {
                import_token,
                path,
                items: Some(tokens.into_iter().map(|t| t.lexeme).collect()),
            });
        }

        // After 'from': identifier → package import (existing, unchanged)
        let namespace = self.consume(&TokenType::Identifier, "Expected namespace")?;
        if self.check(&TokenType::Semicolon) { self.advance(); }
        return Ok(Stmt::ImportFrom {
            path: vec![namespace.lexeme],
            items: tokens.into_iter().map(|t| t.lexeme).collect(),
        });
    }

    // Branch 3: bare identifier → package import (existing, unchanged)
    let namespace = self.consume(&TokenType::Identifier, "Expected namespace")?;
    if self.check(&TokenType::Semicolon) { self.advance(); }
    Ok(Stmt::Import(vec![namespace.lexeme]))
}

/// Strip surrounding double quotes from a string literal lexeme.
fn strip_quotes(lexeme: &str) -> String {
    lexeme.trim_start_matches('"').trim_end_matches('"').to_string()
}
```

This adds two new code paths (string literal branches) while leaving all existing paths unchanged.

## Compile-Time Resolution

The import resolver runs **between parsing and constant folding** — it transforms the AST before lowering begins.

### Pipeline (updated)

```
Tokenize → Parse → Import Resolve → Constant Fold → Lower → SSA → RegAlloc → Peephole → Codegen → Serialize
                         ^^^^^^^^^^^^^^^^^^
                         NEW STEP
```

### Resolution algorithm

```rust
struct ImportResolver {
    /// Files currently being resolved (on the call stack) → cycle detection
    resolving: HashSet<PathBuf>,
    /// Files already fully resolved → deduplication
    resolved: HashSet<PathBuf>,
    /// Cached ASTs for deduplicated imports
    cache: HashMap<PathBuf, Vec<Stmt>>,
    /// Merged grammar for parsing imported files
    grammar: Option<MergedGrammar>,
}

impl ImportResolver {
    fn new(grammar: Option<MergedGrammar>) -> Self {
        Self {
            resolving: HashSet::new(),
            resolved: HashSet::new(),
            cache: HashMap::new(),
            grammar,
        }
    }

    /// Resolve all file imports in the AST, returning a flat list of declarations.
    fn resolve(&mut self, ast: &[Stmt], base_dir: &Path) -> Result<Vec<Stmt>, CompileError> {
        let mut result = Vec::new();

        for stmt in ast {
            match stmt {
                Stmt::ImportFile { import_token, path, items } => {
                    // 1. Resolve path
                    let target = resolve_path(base_dir, path, import_token)?;

                    // 2. Canonicalize for dedup/cycle tracking
                    let canonical = target.canonicalize()
                        .map_err(|_| import_error(path, import_token, "file not found"))?;

                    // 3. Cycle detection: file is on the current resolution stack
                    if self.resolving.contains(&canonical) {
                        return Err(import_error(path, import_token,
                            &format!("circular import detected: {} is already being imported",
                                canonical.display())));
                    }

                    // 4. Deduplication: file was already fully resolved
                    if self.resolved.contains(&canonical) {
                        // Reuse cached declarations, but apply selective filter
                        let cached = self.cache.get(&canonical).unwrap();
                        let filtered = match items {
                            Some(names) => filter_declarations(cached, names, path, import_token)?,
                            None => cached.clone(),
                        };
                        result.extend(filtered);
                        continue;
                    }

                    // 5. Mark as resolving (for cycle detection)
                    self.resolving.insert(canonical.clone());

                    // 6. Read and parse target file
                    let source = std::fs::read_to_string(&target)
                        .map_err(|_| import_error(path, import_token, "could not read file"))?;
                    let target_ast = Parser::new(lexer::tokenize(&source), self.grammar.as_ref())
                        .parse()
                        .map_err(|e| import_error(path, import_token, &e.to_string()))?;

                    // 7. Recursively resolve target's imports
                    let target_dir = target.parent().unwrap_or(base_dir).to_path_buf();
                    let mut target_resolved = self.resolve(&target_ast, &target_dir)?;

                    // 8. Cache the fully resolved AST (before filtering)
                    self.cache.insert(canonical.clone(), target_resolved.clone());

                    // 9. Mark as resolved (remove from resolving, add to resolved)
                    self.resolving.remove(&canonical);
                    self.resolved.insert(canonical);

                    // 10. Apply selective filter if specified
                    if let Some(names) = items {
                        target_resolved = filter_declarations(&target_resolved, names, path, import_token)?;
                    }

                    result.extend(target_resolved);
                }
                other => result.push(other.clone()),
            }
        }

        Ok(result)
    }
}
```

### Path resolution

```rust
fn resolve_path(base_dir: &Path, import_path: &str, token: &Token) -> Result<PathBuf, CompileError> {
    if !import_path.starts_with("./") && !import_path.starts_with("../") {
        return Err(import_error(import_path, token,
            "import path must start with './' or '../' — bare names are for packages"));
    }

    let target = base_dir.join(import_path);
    let target = if target.extension().is_none() {
        target.with_extension("ink")
    } else {
        target
    };

    // Canonicalize to resolve '..' and verify the file exists
    let canonical = target.canonicalize()
        .map_err(|_| import_error(import_path, token,
            &format!("file not found: {}", target.display())))?;

    Ok(canonical)
}
```

Parent directory (`..`) is allowed. Path resolution uses `canonicalize()` which resolves `..` to an absolute path. If the result points outside the project root, the file simply won't exist (or won't be an `.ink` file), and the user gets a "file not found" error.

### Importable declarations

The `filter_declarations` function operates on these `Stmt` variants:

| Stmt variant | Name field | Importable |
|---|---|---|
| `Stmt::Fn { name, .. }` | `name.lexeme` (Token) | Yes |
| `Stmt::Let { name, .. }` | `name.lexeme` (Token) | Yes |
| `Stmt::Const { name, .. }` | `name.lexeme` (Token) | Yes |
| `Stmt::Class { name, .. }` | `name.lexeme` (Token) | Yes |
| `Stmt::Enum { name, .. }` | `name.lexeme` (Token) | Yes |
| `Stmt::GrammarDecl { name, .. }` | `name: String` | Yes |
| `Stmt::Config { name, .. }` | `name.lexeme` (Token) | Yes |
| `Stmt::Table { name, .. }` | `name.lexeme` (Token) | Yes |
| `Stmt::AnnotationDef { name, .. }` | `name.lexeme` (Token) | Yes |
| `Stmt::EventDecl { name, .. }` | `name.lexeme` (Token) | Yes |
| `Stmt::Import(_)` | — | No (resolved away) |
| `Stmt::ImportFrom { .. }` | — | No (resolved away) |
| `Stmt::ImportFile { .. }` | — | No (resolved away) |
| `Stmt::On { .. }` | — | No (event handler, not a declaration) |
| `Stmt::Expr(_)` | — | No (expression statement) |
| `Stmt::If/While/For/Block` | — | No (control flow) |
| `Stmt::Enable/Disable` | — | No (lifecycle blocks) |

```rust
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

fn filter_declarations(
    stmts: &[Stmt],
    names: &[String],
    path: &str,
    token: &Token,
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

    // Error if any requested names were not found
    let missing: Vec<_> = names.iter().filter(|n| !found.contains(*n)).collect();
    if !missing.is_empty() {
        return Err(import_error(path, token,
            &format!("not found in '{}': {}", path, missing.iter().map(|s| format!("'{}'", s)).join(", "))));
    }

    Ok(result)
}
```

### Name collisions

After all imports are resolved, check for name collisions among top-level declarations:

```rust
fn check_name_collisions(stmts: &[Stmt], entry_name: &str) -> Result<(), CompileError> {
    let mut seen: HashMap<String, (String, usize)> = HashMap::new(); // name → (file, line)

    for stmt in stmts {
        if let Some(name) = declaration_name(stmt) {
            if let Some((prev_file, prev_line)) = seen.get(name) {
                return Err(CompileError::Compilation(
                    format!("duplicate declaration '{}': already defined at {}:{}",
                        name, prev_file, prev_line)));
            }
            seen.insert(name.to_string(), (entry_name.to_string(), /* line from stmt */));
        }
    }
    Ok(())
}
```

Rules:
- **Entry point vs. imported**: If the entry point defines `fn greet` and an imported file also defines `fn greet`, it's a compile error. There is no shadowing — explicit is better.
- **Two imported files**: Same rule — duplicate name is an error. Use selective imports to avoid it: `import greet from "./a"` and `import greet as aGreet from "./b"` (though `as` aliases are out of scope for v1 — for now, rename in the source file).
- **`Stmt::On` and `Stmt::Expr`**: Not subject to collision checks — they're not named declarations.

### Error messages

All import errors include the import path and source location:

```
error: circular import detected: './a' is already being imported
  → main.ink:3 import "./a"

error: not found in './utils': 'nonexistent'
  → main.ink:2 import nonexistent from "./utils"

error: duplicate declaration 'greet': already defined at utils.ink:1
  → helpers.ink:5 fn greet()
```

## Scope Rules

- Imported declarations behave as if they were defined at the import site in the entry point
- They share the same chunk and globals as the importing file
- Grammar declarations (`mob`, `player`, `command`) from imported files register their handlers normally — they're just `Stmt::GrammarDecl` nodes in the merged AST
- The 16-register limit is per-function, not per-file — merging declarations adds more functions to the chunk, not more registers per function

## Output

A single `.inkc` file containing all merged code. The output filename matches the entry point: `main.ink` → `main.inkc`. The runtime sees one chunk with all functions from all imported files.

## Lowerer Changes

The existing `lower_import` and `lower_import_from` functions remain unchanged — they handle package/stdlib imports. `ImportFile` nodes never reach the lowerer because they're resolved away by the import resolver before lowering begins.

If an `ImportFile` node somehow reaches the lowerer, emit a compile error:

```rust
Stmt::ImportFile { import_token, .. } => {
    return Err(CompileError::Compilation(
        format!("internal error: unresolved file import at line {}", import_token.line)));
}
```

## Compiler API Changes

### New function signature

The existing `compile_with_grammar` takes `source: &str` and has no filesystem context. Import resolution needs a base directory. Add a new entry point:

```rust
/// Compile an entry point file with import resolution.
/// `entry_path` is the filesystem path to the main .ink file.
/// `grammar` is the merged grammar for grammar-aware parsing.
pub fn compile_entry(
    entry_path: &Path,
    grammar: Option<&MergedGrammar>,
) -> Result<SerialScript, CompileError> {
    let source = std::fs::read_to_string(entry_path)
        .map_err(|e| CompileError::Compilation(format!("could not read '{}': {}", entry_path.display(), e)))?;
    let name = entry_path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("main");

    // 1. Tokenize
    let tokens = lexer::tokenize(&source);

    // 2. Parse
    let ast = Parser::new(tokens, grammar)
        .parse()
        .map_err(|e| CompileError::Parsing(e.to_string()))?;

    // 3. Resolve file imports (NEW)
    let base_dir = entry_path.parent().unwrap_or(Path::new("."));
    let mut resolver = ImportResolver::new(grammar.cloned());
    let resolved_ast = resolver.resolve(&ast, base_dir)?;

    // 4. Name collision check
    check_name_collisions(&resolved_ast, name)?;

    // 5. Constant fold → Lower → SSA → RegAlloc → Peephole → Codegen → Serialize
    let folded = ConstantFolder::new().fold(&resolved_ast);
    let lowered = AstLowerer::new().lower(&folded);
    // ... rest of existing pipeline unchanged
}
```

The existing `compile_with_grammar` function remains for backward compatibility (single-file mode without import resolution).

### CLI change

The CLI already supports single-file mode. The `single_compile` function switches to `compile_entry` when the input file is an entry point (always, once imports are the default):

```rust
fn single_compile(input: &str, output: &str, grammar: Option<&MergedGrammar>, debug: bool) {
    let entry_path = Path::new(input);
    let result = compile_entry(entry_path, grammar);
    // ... write output, same as before
}
```

Batch mode (`--sources`) is deprecated. Quill always passes the entry point file.

## Changes Required

### printing_press (Rust compiler)

1. **`ast.rs`** — Add `Stmt::ImportFile` variant with `import_token: Token`, `path: String`, `items: Option<Vec<String>>`
2. **`parser.rs`** — Add string literal branches to `parse_import()`, add `strip_quotes()` helper
3. **`import_resolver.rs`** — New module with `ImportResolver` struct, `resolve_path()`, `filter_declarations()`, `declaration_name()`, `check_name_collisions()`
4. **`mod.rs`** — Add `compile_entry()` function, existing `compile_with_grammar()` unchanged for backward compat
5. **`lowerer.rs`** — Add error case for unresolved `ImportFile` nodes (safety net)

### quill (TypeScript CLI)

1. **Build command** — Pass entry point file path to `compile_entry` instead of source content
2. **Manifest** — Parse optional `main` field from `ink-package.toml` `[package]` section
3. **`using` scanning** — Before compilation, quill traverses the import graph to discover all `.ink` files, then scans all of them for `using` declarations (see below)
4. **Dependency tracking** — Track import graph for incremental builds: if any imported file changes, recompile from entry point

### `using` scanning across imported files

Since `using` is resolved by quill (not the compiler), quill needs to discover all files that will be imported before invoking the compiler. Solution: quill implements a simple import graph walker using regex scanning:

```typescript
async function discoverImportGraph(entryPoint: string): Promise<string[]> {
  const visited = new Set<string>();
  const queue = [entryPoint];
  const files: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift()!;
    const canonical = path.resolve(file);
    if (visited.has(canonical)) continue;
    visited.add(canonical);

    const source = await fs.readFile(file, 'utf-8');
    files.push(file);

    // Extract file import paths via regex (string literal after import/from)
    const importRegex = /import\s+(?:\w+(?:\s*,\s*\w+)*\s+from\s+)?["'](\.\/[^"']+)["']/g;
    let match;
    while ((match = importRegex.exec(source)) !== null) {
      const importPath = match[1];
      const resolved = path.resolve(path.dirname(file), importPath + '.ink');
      if (!visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return files;
}
```

This is a pre-compilation step that runs before the compiler. It uses simple regex matching (not a full parser) because the compiler hasn't been invoked yet. The compiler's own import resolver will do the full resolution — the regex scanner just needs to find enough files for `using` scanning.

### ink runtime (Kotlin VM)

No changes needed. The runtime loads a single `.inkc` and executes it. Imported code is already merged into the chunk by the compiler.

## Test Scenarios

### Happy path

| Scenario | Files | Expected |
|---|---|---|
| Full import | `main.ink` imports `"./utils"`, utils defines `fn greet` | Single `.inkc` with both `main` and `greet` functions |
| Selective import | `main.ink` imports `greet from "./utils"`, utils defines `fn greet` and `fn farewell` | `greet` compiled, `farewell` not accessible |
| Subdirectory | `main.ink` imports `"./mobs/zombie"` | Resolves to `scripts/mobs/zombie.ink` |
| Parent directory | `scripts/mobs/zombie.ink` imports `"../shared"` | Resolves to `scripts/shared.ink` |
| Diamond import | A imports `"./b"` and `"./c"`, both b and c import `"./d"` | d is compiled once |
| Grammar decls | `main.ink` imports `"./commands"`, commands defines `command setday` | GrammarDecl in merged AST, runtime registers handler |

### Error cases

| Scenario | Expected error |
|---|---|
| Circular import (A→B→A) | `circular import detected` |
| File not found | `file not found: scripts/nonexistent.ink` |
| Selective import of missing name | `not found in './utils': 'missing'` |
| Duplicate name across imports | `duplicate declaration 'greet'` |
| Bare name for file path | `import path must start with './' or '../'` |
| Import from non-declaration file | File with only `import` statements → no declarations imported (OK, no error) |
| Unresolvable `ImportFile` at lowerer | `internal error: unresolved file import` (compiler bug) |

## Scope

**In scope:**
- `import "./file"` syntax (string literal)
- `import x, y from "./file"` syntax (selective with string literal)
- Single entry point compilation
- Circular import detection (compile error)
- Deduplication of repeated imports (diamond)
- Name collision detection (compile error)
- Parent directory (`..`) in paths
- Compiler changes in printing_press
- Build changes in quill
- `using` scanning across imported files

**Out of scope:**
- Package imports via `import` (packages use `using`)
- Import aliases (`import greet as aGreet`)
- Dynamic imports at runtime
- Re-exports (`export { X } from "./file"`)
- Namespace imports (`import * as foo from "./file"`)
- Lazy imports
- `export default`
- Changes to the `using` keyword or grammar package system
