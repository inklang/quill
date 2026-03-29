# printing_press Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate printing_press Rust compiler into quill binary as a local library, replacing Java subprocess compilation with direct `printing_press::compile()` calls, and exposing a `quill compile` CLI subcommand.

**Architecture:** Copy printing_press source into `quill/src/printing_press/` as a local Rust library. Add path dependency in Cargo.toml. Wire `printing_press::compile()` into the CLI and build pipeline. No new dependencies — printing_press's deps (`clap`, `serde`, `serde_json`, `thiserror`) are already present in quill.

**Tech Stack:** Rust, clap, serde, serde_json, thiserror

---

## Chunk 1: Copy printing_press Source into quill

**Files:**
- Create: `quill/src/printing_press/lib.rs` (from `printing_press/src/lib.rs`)
- Create: `quill/src/printing_press/inklang/` (all `.rs` files from `printing_press/src/inklang/`)

- [ ] **Step 1: Copy printing_press lib.rs**

Copy `/c/Users/justi/dev/printing_press/src/lib.rs` → `quill/src/printing_press/lib.rs`

Note: printing_press/src/main.rs is NOT copied — quill's main.rs takes over CLI.

- [ ] **Step 2: Copy printing_press inklang directory**

Copy all `.rs` files from `/c/Users/justi/dev/printing_press/src/inklang/` → `quill/src/printing_press/inklang/`, preserving subdirectory structure:

```
quill/src/printing_press/inklang/
├── ast.rs
├── chunk.rs
├── codegen.rs
├── constant_fold.rs
├── error.rs
├── grammar.rs
├── import_resolver.rs
├── ir.rs
├── lexer.rs
├── liveness.rs
├── lowerer.rs
├── mod.rs
├── parser.rs
├── peephole.rs
├── register_alloc.rs
├── serialize.rs
├── spill_insert.rs
├── token.rs
├── value.rs
└── ssa/
    ├── block.rs
    ├── builder.rs
    ├── deconstructor.rs
    ├── function.rs
    ├── mod.rs
    ├── passes/
    │   ├── algebraic.rs
    │   ├── constant_propagation.rs
    │   ├── copy_propagation.rs
    │   ├── dce.rs
    │   ├── gvn.rs
    │   └── mod.rs
    └── value.rs
```

Run:
```bash
mkdir -p quill/src/printing_press/inklang/ssa/passes
cp /c/Users/justi/dev/printing_press/src/inklang/*.rs quill/src/printing_press/inklang/
cp -r /c/Users/justi/dev/printing_press/src/inklang/ssa quill/src/printing_press/inklang/
```

- [ ] **Step 3: Verify files copied**

Run: `find quill/src/printing_press -name "*.rs" | wc -l`
Expected: 27 files

---

## Chunk 2: Add printing_press as Path Dependency

**Files:**
- Modify: `quill/Cargo.toml`

- [ ] **Step 1: Add printing_press as local path dependency in Cargo.toml**

Read `quill/Cargo.toml` and add:
```toml
printing_press = { path = "src/printing_press" }
```

Place it in the `[dependencies]` section.

- [ ] **Step 2: Verify no duplicate deps**

Confirm `clap`, `serde`, `serde_json`, `thiserror` are already present in quill's `[dependencies]` — no changes needed for those.

- [ ] **Step 3: Run cargo check to verify dependency resolution**

Run: `cd quill && cargo check 2>&1 | head -50`
Expected: Errors about `mod printing_press` not found in main.rs (expected — next chunk fixes this)

---

## Chunk 3: Wire printing_press into main.rs

**Files:**
- Modify: `quill/src/main.rs`

printing_press's `lib.rs` exports: `compile`, `compile_with_grammar`, `compile_entry`, `SerialScript`

- [ ] **Step 1: Add `mod printing_press;` to main.rs**

Add `mod printing_press;` at the top of `quill/src/main.rs`.

- [ ] **Step 2: Read printing_press main.rs to port compile subcommand**

Read `/c/Users/justi/dev/printing_press/src/main.rs` to understand the CLI structure being ported. Port the `compile` subcommand into quill's `Cli` enum in `quill/src/cli.rs`.

The compile command interface:
```
quill compile <INPUT> -o <OUTPUT>       # single file
quill compile --sources <DIR> --out <DIR>  # batch
quill compile --debug ...               # pretty-print JSON
```

- [ ] **Step 3: Add compile command handler in main.rs**

Wire the `compile` subcommand to call `printing_press::compile()`. The handler should:
1. Read the source file(s)
2. Call `printing_press::compile(&source, name)` for each file
3. Write JSON output to the specified output path

Error handling: map `CompileError` to a user-friendly message.

- [ ] **Step 4: Run cargo check**

Run: `cd quill && cargo check 2>&1 | head -50`
Expected: No errors (or only minor type mismatches to fix)

---

## Chunk 4: Replace Java Subprocess with printing_press::compile()

**Files:**
- Modify: `quill/src/util/compiler.rs`

- [ ] **Step 1: Read current compiler.rs implementation**

Read `quill/src/util/compiler.rs` to understand what to replace.

- [ ] **Step 2: Replace compile_file() with printing_press::compile()**

Replace the `compile_file()` function (which shells out to Java) with a new `compile_ink()` function:

```rust
use printing_press::{compile, SerialScript};

pub fn compile_ink(source: &Path, output: &Path) -> Result<()> {
    let source_text = std::fs::read_to_string(source)
        .map_err(|e| QuillError::io_error("failed to read source", e))?;
    let name = source.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("main");
    let script: SerialScript = compile(&source_text, name)
        .map_err(|e| QuillError::CompilerFailed {
            script: source.to_string_lossy().into(),
            stderr: e.display().to_string(),
        })?;
    let json = serde_json::to_string(&script)
        .map_err(|e| QuillError::RegistryAuth {
            message: format!("failed to serialize compiled output: {}", e),
        })?;
    std::fs::write(output, json)
        .map_err(|e| QuillError::io_error("failed to write output", e))?;
    Ok(())
}
```

- [ ] **Step 3: Remove obsolete code from compiler.rs**

Remove:
- `resolve_compiler()` function
- The `dirs` sub-module
- All `use std::process::Command` imports

Keep any utility functions that are still needed.

- [ ] **Step 4: Update QuillError enum**

Read `quill/src/error.rs` and verify `CompilerFailed` variant exists with fields `{ script: String, stderr: String }`. If it has a different shape, update accordingly.

- [ ] **Step 5: Run cargo check**

Run: `cd quill && cargo check 2>&1 | head -80`
Expected: No errors related to compiler.rs

---

## Chunk 5: Update build.rs to Use New compile_ink()

**Files:**
- Modify: `quill/src/commands/build.rs`

- [ ] **Step 1: Update imports in build.rs**

Replace:
```rust
use crate::util::compiler::{compile_file, resolve_compiler};
```

With:
```rust
use crate::util::compiler::compile_ink;
```

- [ ] **Step 2: Replace compile_file() calls with compile_ink()**

In `build.rs` `execute()` method, find:
```rust
compile_file(&compiler, source_file, &output_file)?;
```

Replace with:
```rust
compile_ink(source_file, &output_file)?;
```

Also remove the line `let compiler = resolve_compiler()?;` since it's no longer needed.

- [ ] **Step 3: Run cargo check**

Run: `cd quill && cargo check 2>&1 | head -80`
Expected: No errors

---

## Chunk 6: Build and Smoke Test

- [ ] **Step 1: Build the binary**

Run: `cd quill && cargo build --release 2>&1`
Expected: Clean build, produces `target/release/quill`

- [ ] **Step 2: Test compile subcommand help**

Run: `cd quill && cargo run -- compile --help`
Expected: Shows compile subcommand help with `-o/--output` and `--sources/--out` options

- [ ] **Step 3: Find a test .ink file**

Look in `quill/../ink` repo or `tests/fixtures/` for an `.ink` source file to compile.

- [ ] **Step 4: Run compile on a test file**

Run: `cd quill && cargo run -- compile /path/to/test.ink -o /tmp/test.inkc`
Expected: Produces `/tmp/test.inkc` with JSON bytecode

- [ ] **Step 5: Verify .inkc output is valid JSON**

Run: `cat /tmp/test.inkc | python3 -m json.tool > /dev/null && echo "valid JSON"`
Expected: "valid JSON"

---

## Chunk 7: Commit

- [ ] **Step 1: Review changed files**

Run: `cd quill && git status`
Expected: New `src/printing_press/` directory, modified `Cargo.toml`, `src/main.rs`, `src/util/compiler.rs`, `src/commands/build.rs`

- [ ] **Step 2: Stage and commit**

```bash
cd quill
git add -A
git commit -m "feat: integrate printing_press compiler as local library

Copies printing_press/src/ into quill/src/printing_press/ as a local Rust
module. Replaces Java subprocess compile_file() with printing_press::compile().
Adds quill compile CLI subcommand for single-file and batch .ink compilation.

Known limitation: build.rs grammar merging (GrammarIr) does not bridge to
printing_press::compile_with_grammar() in this chunk — grammar auto-discovery
is used instead. Grammar bridging is future work.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
