# Quill + Printing Press Merge Design

## Status
Approved by user: 2026-03-26

## Goal

Merge the Printing Press Rust compiler into the Quill repository as a local module, producing a single `quill` binary that serves as a full Ink toolchain (package manager + compiler).

## Why

- **Single binary distribution** — no need to install/target multiple executables
- **Direct library calls** — replace `std::process::Command` subprocess invocations with in-process `printing_press::compile()`
- **Unified development** — one repo, one CI pipeline, atomic version bumps

## Architecture

### Directory Structure

```
quill/
├── Cargo.toml              # Root workspace or single crate
├── src/
│   ├── main.rs             # Quill CLI entry point + printing_press re-exports
│   ├── printing_press/     # Moved from printing_press/src/
│   │   ├── inklang/
│   │   │   ├── lexer.rs
│   │   │   ├── parser.rs
│   │   │   ├── grammar.rs
│   │   │   ├── codegen.rs
│   │   │   ├── lowerer.rs
│   │   │   └── ...
│   │   ├── lib.rs          # printing_press::(compile, compile_with_grammar, SerialScript)
│   │   └── main.rs         # Deleted (functionality moved to quill/src/main.rs)
│   ├── cli/                # Existing quill CLI commands
│   │   ├── install.rs
│   │   ├── publish.rs
│   │   ├── login.rs
│   │   └── ...
│   └── ...
└── docs/superpowers/specs/
```

### Module Integration

- `src/printing_press/` is added as `mod printing_press;` in `src/main.rs`
- `printing_press::{compile, compile_with_grammar, SerialScript}` are re-exported from main for use by quill CLI commands
- Existing CLI commands that currently shell out to `printing-press` binary are updated to call the library directly

### CLI Command Mapping

| Printing Press | Quill |
|---|---|
| `printing-press compile INPUT -o OUTPUT` | `quill compile INPUT -o OUTPUT` |
| `printing-press compile --sources DIR --out DIR` | `quill compile --sources DIR --out DIR` |
| `--debug` (pretty-print JSON) | `--debug` (preserved) |

### Deletions

- `printing_press/src/main.rs` — removed; `quill/src/main.rs` takes over
- `printing_press/Cargo.toml` — removed; its Cargo.toml contents merged into quill's
- `printing_press/.worktrees/` — archived or removed

## Implementation Steps

1. **Copy** `printing_press/src/` → `quill/src/printing_press/`, preserving file contents
2. **Merge** `printing_press/Cargo.toml` deps (`clap`, `serde`, `serde_json`, `thiserror`) into quill's `Cargo.toml`
3. **Add** `mod printing_press;` and re-export `compile`, `compile_with_grammar`, `SerialScript` in `quill/src/main.rs`
4. **Delete** `printing_press/src/main.rs` and `printing_press/Cargo.toml`
5. **Update** quill CLI commands that call `printing-press` via subprocess to call `printing_press::compile()` directly
6. **Port** the `compile` subcommand from `printing_press/src/main.rs` into quill's CLI using `clap`
7. **Verify** `cargo build --release` produces a single `quill` binary

## Dependencies

Printing Press brings: `clap`, `serde`, `serde_json`, `thiserror`

Quill currently has no Rust dependencies (it's a Node.js CLI). This merge transitions quill from TypeScript/Node.js to Rust.

**Note:** Quill's existing TypeScript implementation will be replaced. This is a full rewrite in Rust, not a hybrid approach.

## Open Questions

None — scope is fully defined by user approval.
