# printing_press Integration into quill Binary

> **Status:** Approved by user: 2026-03-29
> **Scope:** Chunk 1 + Chunk 2 of the Quill + Printing Press Merge Plan

## Goal

Integrate the printing_press Rust compiler into the quill binary as a local library module, replacing the Java-based subprocess compilation with direct `printing_press::compile()` calls, and exposing a `quill compile` CLI subcommand.

## What This Covers

- Copy printing_press source into `quill/src/printing_press/`
- Add as a path dependency in `Cargo.toml`
- Replace the Java subprocess `compile_file()` in `src/util/compiler.rs` with `printing_press::compile()`
- Port the `compile` subcommand from printing_press's `main.rs` into quill's CLI

## What This Does NOT Cover

- Porting other Quill CLI commands (those are already in Rust; this chunk only touches compile)
- Deleting TypeScript files
- Archiving the printing_press repo

---

## Architecture

### Directory Structure

```
quill/
├── Cargo.toml                        # Add printing_press as path dependency
├── src/
│   ├── main.rs                       # Add compile subcommand + mod printing_press
│   ├── printing_press/               # Copied from printing_press/src/
│   │   ├── lib.rs
│   │   └── inklang/
│   │       ├── ast.rs
│   │       ├── chunk.rs
│   │       ├── codegen.rs
│   │       ├── constant_fold.rs
│   │       ├── error.rs
│   │       ├── grammar.rs
│   │       ├── import_resolver.rs
│   │       ├── ir.rs
│   │       ├── lexer.rs
│   │       ├── liveness.rs
│   │       ├── lowerer.rs
│   │       ├── mod.rs
│   │       ├── parser.rs
│   │       ├── peephole.rs
│   │       ├── register_alloc.rs
│   │       ├── serialize.rs
│   │       ├── spill_insert.rs
│   │       ├── token.rs
│   │       ├── value.rs              # top-level value types
│   │       └── ssa/
│   │           ├── block.rs
│   │           ├── builder.rs
│   │           ├── deconstructor.rs
│   │           ├── function.rs
│   │           ├── mod.rs
│   │           ├── passes/
│   │           │   ├── algebraic.rs
│   │           │   ├── constant_propagation.rs
│   │           │   ├── copy_propagation.rs
│   │           │   ├── dce.rs
│   │           │   ├── gvn.rs
│   │           │   └── mod.rs
│   │           └── value.rs
│   ├── util/
│   │   └── compiler.rs               # Replace java subprocess with printing_press::compile()
│   └── commands/
│       └── build.rs                  # Use new internal compile fn
```

### Module Integration

- `src/printing_press/` is added as `mod printing_press;` in `src/main.rs`
- `printing_press::{compile, compile_with_grammar, SerialScript}` re-exported from lib.rs for use by quill commands
- printing_press's `src/main.rs` is NOT copied — quill's `src/main.rs` takes over CLI parsing

## Changes Detail

### Cargo.toml

Add printing_press as a local path dependency. printing_press deps (`clap`, `serde`, `serde_json`, `thiserror`) are **already present** in quill's `Cargo.toml` at compatible versions — no new deps needed. Simply add:

```toml
# printing_press as local library
printing_press = { path = "src/printing_press" }
```

Note: quill already has `clap = { version = "4.5", features = ["derive"] }` — printing_press requires `4`, which is satisfied by `4.5`.

### src/main.rs

1. Add `mod printing_press;` at the top
2. Add `compile` subcommand to the CLI enum
3. Port the `compile` command handler from printing_press's `main.rs`

Compile subcommand interface:
```
quill compile <INPUT> -o <OUTPUT>       # single file compile
quill compile --sources <DIR> --out <DIR>  # batch compile
quill compile --debug ...               # pretty-print JSON output
```

### src/util/compiler.rs

Replace `compile_file()` function that shells out to Java with a new `compile_ink()` function that calls `printing_press::compile()` directly.

**Before:**
```rust
pub fn compile_file(compiler: &Path, source: &Path, output: &Path) -> Result<()> {
    let status = Command::new("java")
        .args(["-jar", &compiler.to_string_lossy(), "compile", ...])
        .output()?;
    ...
}
```

**After:**
```rust
use printing_press::{compile, SerialScript};

pub fn compile_ink(source: &Path, output: &Path) -> Result<()> {
    let source_text = std::fs::read_to_string(source)?;
    let script: SerialScript = compile(&source_text, source.file_stem().unwrap().to_str().unwrap())
        .map_err(|e| QuillError::CompilerFailed {
            script: source.to_string_lossy().into(),
            stderr: e.display().to_string(),
        })?;
    let json = serde_json::to_string(&script)?;
    std::fs::write(output, json)?;
    Ok(())
}
```

Note: `printing_press::compile` returns `Result<SerialScript, printing_press::CompileError>`. Use `.map_err(|e| ... | stderr: e.display().to_string())` — there is no `printing_press::Error` type.

The old `resolve_compiler()`, `compile_file()`, and the `dirs` sub-module in `compiler.rs` can be removed entirely since `printing_press` is now in-process.

### src/commands/build.rs

Replace:
```rust
use crate::util::compiler::{compile_file, resolve_compiler};
```

With the new internal compile function. The function signature may change slightly since it no longer needs a `compiler` path argument.

## CLI Command Mapping

| printing_press CLI | quill CLI |
|---|---|
| `printing-press compile <INPUT> -o <OUTPUT>` | `quill compile <INPUT> -o <OUTPUT>` |
| `printing-press compile --sources DIR --out DIR` | `quill compile --sources DIR --out DIR` |
| `printing-press compile --debug ...` | `quill compile --debug ...` |

## Integration Points

### `quill compile` CLI

`quill compile` calls `printing_press::compile()` directly. This function internally calls `auto_discover_grammar()` which searches for pre-compiled `dist/grammar.ir.json` files. For standalone single-file or batch compilation without a full project context, this is the correct behavior.

### `build.rs` Integration — Grammar Handling

**Current state:** `build.rs` performs its own grammar merging — it parses `grammar.ink-grammar` files from the local project and dependencies into a `GrammarIr`, then passes that merged grammar to the compiler. However, `printing_press::compile()` does **not** accept a `GrammarIr` — it accepts `Option<&MergedGrammar>` (an internal type).

**For this integration chunk:** `build.rs` calls `compile_ink()` (which calls `printing_press::compile()`). This means grammar auto-discovery runs instead of using quill's merged `GrammarIr`. This is a **known limitation** — the merged grammar pipeline will be addressed in a future chunk.

**Future work (out of scope):** Add a `GrammarIr` → `MergedGrammar` conversion layer so `build.rs` can pass its merged grammar to the compiler via `compile_with_grammar()`.

### Error Conversion

`Result<SerialScript, CompileError>` → `QuillError::CompilerFailed` via `map_err` with `e.display().to_string()` for the stderr field.

## Verification

1. `cargo build --release` succeeds with no errors
2. `cargo run -- compile tests/fixtures/scripts-compile-project/src/main.ink -o /tmp/test.inkc` produces valid `.inkc` JSON
3. `cargo run -- build` on an existing project produces identical output to the TypeScript version

## Dependencies Brought In

printing_press brings: `clap`, `serde`, `serde_json`, `thiserror` — all already in quill's dep list, so no new transitive deps.

## Open Questions

### Known Limitation: Grammar Bridging

quill's `build.rs` merges grammars from `grammar.ink-grammar` files into a `GrammarIr`, but `printing_press::compile_with_grammar()` expects `&MergedGrammar` (an internal type, not `GrammarIr`). This integration chunk uses `printing_press::compile()` which auto-discovers grammars, bypassing quill's merged grammar logic. A future chunk must add a `GrammarIr` → `MergedGrammar` conversion layer before grammar-aware build compilation can work properly with custom grammars.

### Printing_press Exports

printing_press exports `compile`, `compile_with_grammar`, `compile_entry`, and `SerialScript` from `lib.rs`. `compile_entry` (which handles Ink import resolution for entry-point compilation) is noted but not wired into the quill build pipeline in this chunk — it becomes relevant when supporting Ink `import` statements.
