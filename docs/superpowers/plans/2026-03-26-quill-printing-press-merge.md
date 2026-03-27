# Quill + Printing Press Merge Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Printing Press compiler into the Quill repository as a local Rust module, replacing the TypeScript/Node.js CLI with a single Rust binary.

**Architecture:** Quill's TypeScript (`src/*.ts`) is replaced entirely with Rust (`src/**/*.rs`). Printing Press (`printing_press/src/`) is moved into `quill/src/printing_press/` as a local module. The CLI uses `clap` for argument parsing. Subprocess invocations of `printing-press` are replaced with direct `printing_press::compile()` calls.

**Tech Stack:** Rust, `clap` (CLI), `serde`/`serde_json` (serialization), `thiserror` (errors), `tokio` (async I/O), `toml` (TOML parsing), `tar` (tarball creation with `flate2`), `reqwest` (HTTP client), `tiny_http` (local OAuth callback server), `clap_complete` (shell completions), `sha2` (checksums), `hex` (hex encoding), `dirs` (home dir), `which` (path resolution), `semver` (version parsing), `colorette` (colored output), `chokidar` (file watching)

---

## Chunk 1: Project Scaffolding

Create the Rust project structure in the quill repo. The TypeScript files are kept as reference — they will be deleted after the Rust rewrite is complete.

**Files:**
- Create: `Cargo.toml`
- Create: `src/main.rs`
- Create: `src/cli/mod.rs` (placeholder)
- Create: `src/printing_press.rs` (placeholder module)

- [ ] **Step 1: Create Cargo.toml at quill root**

```toml
[package]
name = "quill"
version = "0.3.9"
edition = "2021"
description = "Package manager and compiler for the Ink programming language"
license = "MIT"
repository = "https://github.com/inklang/quill"

[[bin]]
name = "quill"
path = "src/main.rs"

[[bin]]
name = "q"
path = "src/main.rs"

[dependencies]
clap = { version = "4", features = ["derive"] }
clap_complete = "4"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
toml = "0.8"
tar = { version = "0.4", features = ["flate2-sync"] }
flate2 = "1"
reqwest = { version = "0.12", features = ["json", "multipart"] }
tokio = { version = "1", features = ["full"] }
colorette = "0.6"
chokidar = "4"
sha2 = "0.10"
hex = "0.4"
dirs = "5"
which = "6"
semver = "1"
tiny_http = "0.12"
opener = "0.7"
```

- [ ] **Step 2: Create src/main.rs with clap CLI skeleton**

```rust
mod printing_press;

use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "quill", version = "0.3.9", about = "Package manager and compiler for the Ink programming language")]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Parser, Debug)]
enum Command {
    Compile(CompileArgs),
}

#[derive(Parser, Debug)]
struct CompileArgs {
    #[command(subcommand)]
    command: CompileCommand,
}

#[derive(Parser, Debug)]
enum CompileCommand {
    /// Compile a single .ink file
    File {
        input: String,
        #[arg(short, long)]
        output: String,
    },
    /// Batch compile all .ink files in a directory
    Batch {
        #[arg(long)]
        sources: String,
        #[arg(long)]
        out: String,
    },
}

fn main() {
    let args = Args::parse();
    match args.command {
        Command::Compile(c) => match c.command {
            CompileCommand::File { input, output } => {
                compile_file(&input, &output);
            }
            CompileCommand::Batch { sources, out } => {
                compile_batch(&sources, &out);
            }
        },
    }
}

fn compile_file(input: &str, output: &str) {
    let source = std::fs::read_to_string(input).expect("failed to read input");
    let script = printing_press::compile(&source, "main").expect("compilation failed");
    let json = serde_json::to_string(&script).expect("serialization failed");
    std::fs::write(output, json).expect("failed to write output");
    println!("Compiled {input} → {output}");
}

fn compile_batch(sources_dir: &str, out_dir: &str) {
    std::fs::create_dir_all(out_dir).expect("failed to create output directory");
    let entries: Vec<_> = std::fs::read_dir(sources_dir)
        .expect("failed to read sources directory")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "ink"))
        .collect();

    if entries.is_empty() {
        println!("No .ink files found in {sources_dir}");
        return;
    }

    let mut errors = 0;
    for entry in entries {
        let input_path = entry.path();
        let file_name = input_path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown");
        let output_path = std::path::Path::new(out_dir).join(format!("{file_name}.inkc"));

        let source = match std::fs::read_to_string(&input_path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("error: could not read file '{}': {}", input_path.display(), e);
                errors += 1;
                continue;
            }
        };

        match printing_press::compile(&source, file_name) {
            Ok(script) => {
                let json = serde_json::to_string(&script).expect("serialization failed");
                std::fs::write(&output_path, json).expect("failed to write output");
                println!("Compiled {} → {}", input_path.file_name().unwrap().to_str().unwrap(), output_path.file_name().unwrap().to_str().unwrap());
            }
            Err(e) => {
                eprintln!("error: compilation failed for '{}': {}", input_path.display(), e);
                errors += 1;
            }
        }
    }

    if errors > 0 {
        eprintln!("{errors} file(s) failed to compile");
        std::process::exit(1);
    }
}
```

- [ ] **Step 3: Copy printing_press source files**

Copy all files from `printing_press/src/` → `quill/src/printing_press/`, preserving directory structure:
- `quill/src/printing_press/lib.rs`
- `quill/src/printing_press/main.rs` (will be deleted later)
- `quill/src/printing_press/inklang/*.rs`

Run: `cp -r ../printing_press/src/* src/printing_press/`

- [ ] **Step 4: Create placeholder src/printing_press.rs shim**

```rust
pub use printing_press::{compile, compile_with_grammar, SerialScript};
```

- [ ] **Step 5: Verify cargo build compiles**

Run: `cargo build --release`
Expected: Builds without errors, produces `target/release/quill` binary

- [ ] **Step 6: Test compile subcommand works**

Run: `cargo run -- compile --help`
Expected: Shows compile subcommand help

---

## Chunk 2: Integrate Printing Press as Local Module

Remove the `main.rs` shim, add printing_press as a proper local path dependency, and wire up the compile command fully.

**Files:**
- Modify: `Cargo.toml`
- Delete: `src/printing_press/main.rs` (printing_press's old main)
- Modify: `src/printing_press.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Add printing_press as a local path library in Cargo.toml**

Add to `[dependencies]`:
```toml
printing_press = { path = "src/printing_press" }
```

Remove `printing_press` from `[dependencies]` section (it's now the library name).

- [ ] **Step 2: Delete src/printing_press/main.rs**

Printing Press's CLI logic is now in quill's main.rs. Delete the printing_press crate's main.rs since its functionality is superseded.

Run: `rm src/printing_press/main.rs`

- [ ] **Step 3: Verify printing_press lib.rs compiles as a local crate**

Run: `cargo check`
Expected: No errors from printing_press module

- [ ] **Step 4: Verify compile command works with a real .ink file**

Create a test `.ink` file and run `cargo run -- compile <file> -o <output>` — verify it produces `.inkc` JSON output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: scaffold Rust quill binary with printing_press as local module

Copies printing_press/src/ into quill/src/printing_press/ as a local library.
Adds Cargo.toml with all required dependencies.
Initial compile command wired up using printing_press::compile directly.
Replaces subprocess invocation with in-process library call.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: Port All Quill CLI Commands

Rewrite all remaining quill CLI commands in Rust using `clap`. Keep the existing TypeScript command implementations as reference.

**Commands to port (in order):**

### Project Commands
1. `new` — scaffold a new project
2. `init` — create ink-package.toml

### Package Management Commands
3. `add` — install a package
4. `remove` — uninstall a package (alias: `uninstall`)
5. `install` — install from ink-package.toml
6. `update` — update dependencies
7. `ls` — list installed packages
8. `clean` — remove `.quill-cache/` (downloaded tarballs)
9. `outdated` — check for newer versions
10. `why` — show why a package is installed (dependency tree)

### Build/Compile Commands
11. `build` — compile grammar + scripts (replace subprocess calls with `printing_press::compile`)
12. `check` — type-check scripts
13. `watch` — watch mode (file watcher with debounced rebuilds)
14. `run` — build + deploy + run Paper server (complex: downloads server JAR, writes eula.txt/server.properties, spawns java process, manages redeploy on file changes)

### Registry Commands
15. `login` — browser-based OAuth flow (opens browser, starts local HTTP server, captures token)
16. `logout` — remove ~/.quillrc
17. `publish` — publish package (multipart upload: tarball + description + readme)
18. `unpublish` — remove published version (DELETE /api/packages/:name/:version)
19. `search` — search registry (hybrid FTS + vector search)
20. `info` — show package details

### Meta Commands
21. `doctor` — diagnostics (checks registry, compiler, network)
22. `cache-info` / `cache` — show build cache info
23. `cache clean` — remove `.quill/cache/` (build manifest cache)
24. `cache ls` — list cached package tarballs
25. `test` — run tests (`--ink` stub: compiles `_test.ink` files; vitest delegation for TypeScript tests)
26. `audit` — vulnerability scan + bytecode safety + checksum verification
27. `completions` — shell completions (bash, zsh, fish via clap_complete)

**Files per command (example for `new`):**
- Create: `src/commands/new.rs`
- Modify: `src/commands/mod.rs`
- Modify: `src/main.rs`

Each command follows this pattern in `src/commands/mod.rs`:
```rust
pub mod new;
pub mod init;
pub mod add;
// ... etc
```

Each command implements a `run()` method:
```rust
// src/commands/new.rs
pub struct NewCommand;

impl NewCommand {
    pub fn run(&self, name: &str, opts: &NewOpts) -> Result<(), Box<dyn std::error::Error>> {
        // implementation
    }
}
```

- [ ] **Step 1: Create src/commands/mod.rs with all module declarations**

```rust
pub mod new;
pub mod init;
pub mod add;
pub mod remove;
pub mod install;
pub mod update;
pub mod ls;
pub mod clean;
pub mod outdated;
pub mod why;
pub mod build;
pub mod check;
pub mod watch;
pub mod run;
pub mod login;
pub mod logout;
pub mod publish;
pub mod unpublish;
pub mod search;
pub mod info;
pub mod doctor;
pub mod cache;
pub mod test;
pub mod audit;
pub mod completions;
```

- [ ] **Step 2: For each command (new, init, add, remove (+ uninstall alias), install, update, ls, clean, outdated, why, build, check, watch, run, login, logout, publish, unpublish, search, info, doctor, cache-info, cache clean, cache ls, test, audit, completions):**

- Create `src/commands/<name>.rs` with the Rust implementation
- Add `pub mod <name>;` to `src/commands/mod.rs`
- Add the clap subcommand definition to `src/main.rs`

Note: `run` is complex — it downloads Paper server JAR from papermc.io API, downloads Ink.jar from GitHub releases, writes eula.txt and server.properties, spawns a java process, and manages a file watcher for redeploy. Consider implementing `run` as multiple sub-commands or with careful sub-stepping.

- [ ] **Step 3: For each command group, verify compilation**

Run: `cargo build --release` after each group of ~5 commands
Expected: No compilation errors

---

## Chunk 4: Delete TypeScript Files

Once all commands are ported and verified working, delete the TypeScript source files.

**Files to delete:**
- `src/*.ts` (all TypeScript source files)
- `src/commands/*.ts`
- `src/grammar/*.ts`
- `src/audit/*.ts`
- `src/cache/*.ts`
- `src/model/*.ts`
- `src/registry/*.ts`
- `src/ui/*.ts`
- `src/util/*.ts`
- `package.json`
- `tsconfig.json`
- `compiler/` (old bundled compiler — superseded by in-tree printing_press)
- `tests/` (port any valuable tests to Rust)

- [ ] **Step 1: Delete all TypeScript source files**

Run: `rm -rf src/*.ts src/commands/*.ts src/grammar/*.ts src/audit/*.ts src/cache/*.ts src/model/*.ts src/registry/*.ts src/ui/*.ts src/util/*.ts`

- [ ] **Step 2: Delete package.json, tsconfig.json, tests/, and compiler/ directory**

Run: `rm package.json tsconfig.json tests/ compiler/` — the `compiler/` directory contains the old bundled Ink JAR (superseded by the in-tree printing_press module).

- [ ] **Step 3: Verify cargo build still succeeds**

Run: `cargo build --release`
Expected: Clean build, no TypeScript artifacts referenced

---

## Chunk 5: Archive printing_press Repo

The printing_press repository is now merged into quill. Archive or delete it.

- [ ] **Step 1: If printing_press is in a separate git repo, remove its .git or mark as archived**

Run in printing_press/: `git archive -o ../quill/printing_press-backup.tar HEAD` (optional backup)

Or simply leave it — the quill repo now contains the full history via the copied files.

---

## Chunk 6: Final Verification

- [ ] **Step 2: cargo build --release produces single quill binary**

Run: `cargo build --release && ls -lh target/release/quill`
Expected: Single binary, no .js, .ts, or node_modules

- [ ] **Step 3: Backward-compatibility verification**

Test a full `add` → `build` → `run` cycle against an existing Ink project (e.g., in the ink repo under `examples/ink.mobs/` or `ink-bukkit/run/plugins/Ink/plugins/`) to ensure the merged toolchain produces the same output as the TypeScript version.

- [ ] **Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: complete Rust rewrite of quill CLI

Quill is now a single Rust binary. The TypeScript/Node.js implementation
has been replaced with a Rust rewrite using clap for CLI parsing.
Printing Press compiler is inlined as src/printing_press/ local module.
All 27 CLI commands ported from TypeScript to Rust.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Key Implementation Notes

### Auth (login/logout)
- `~/.quillrc` JSON file with mode 0o600
- Browser OAuth flow: open `/cli-auth`, start local HTTP server, capture token from callback
- Rust equivalent: `tiny_http` or `warp` for local server, `opener` or `webbrowser` crate for browser launch

### Registry Client
- HTTP calls to registry API — use `reqwest`
- Multipart file upload for publish — use `reqwest::multipart`
- TOML parsing — use `toml` crate
- Tarball creation — use `tar` + `flate2` crates

### Compiler Invocation (build/check/watch)
- Replace `execSync("printing-press compile ...")`, `spawnSync("printing-press compile ...")` with direct `printing_press::compile()` or `printing_press::compile_with_grammar()`
- Grammar discovery: `printing_press::inklang::grammar::discover_grammars()`
- Incremental build cache: port the manifest JSON serialization from TypeScript to Rust
- **Grammar file compilation**: `InkBuildCommand.buildGrammar()` dynamically loads a TypeScript grammar file via `npx tsx` at build time. Since the TypeScript grammar authoring utilities (`src/grammar/api.ts`, `serializer.ts`, `validator.ts`) are deleted, this pipeline changes. Recommended approach: pre-compile grammar `.ts` files to `.ir.json` using the existing TypeScript tooling before the Rust rewrite, then have printing_press load the `.ir.json` directly via `compile_with_grammar()`. The Rust quill build command should consume pre-built `.ir.json` grammar files, not dynamically compile `.ts` grammar sources.

### Shell Completions
- `clap` has built-in completion generation: `clap::Command::gen_completions_to_file()`
- Use `clap_complete` crate for shell completion support

### File Watching
- `chokidar` crate (already in dependencies) — port `WatchCommand`
- Debounce file changes, re-run `printing_press::compile()` on dirty files
