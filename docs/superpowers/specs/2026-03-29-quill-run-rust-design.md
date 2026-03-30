# Quill Run Command (Rust) — Design

> **Goal**: Implement `quill run` for the Rust rewrite of the Quill CLI.

**Architecture**: `Run` struct implements the `Command` trait. Its `execute` method:
1. Calls `Build::execute(ctx)` directly to compile
2. Sets up server directory (Paper JAR + Ink.jar + eula.txt + server.properties)
3. Deploys compiled scripts to server plugins dir
4. Spawns Paper server as a child process using `tokio::process::Command`
5. In watch mode: uses `notify` crate to watch source dirs, rebuilds + redeploys on change, handles server crash with exponential backoff restart

**Shell out to Build**: `Build::execute(ctx)` called directly — the manifest is already loaded by the time commands dispatch via `commands::execute()`.

**File Map**:

| File | Change |
|------|--------|
| `quill/src/commands/run.rs` | **New** — `Run` struct with `execute` |
| `quill/src/commands/mod.rs` | Add `pub mod run` + export + match arm |
| `quill/src/cli.rs` | Add `Run` variant to `Commands` enum |
| `quill/Cargo.toml` | Add `notify` dependency |

---

## `Run` struct and CLI

```rust
pub struct Run {
    pub no_watch: bool,  // --no-watch flag
}

#[derive(Subcommand, Debug)]
Commands::Run {
    #[arg(long)]
    no_watch: bool,
}
```

## Server directory resolution

`server.dir` from `ink-package.toml` resolved with `path.is_absolute()`:
- absolute → use as-is
- relative → `project_dir.join(server_path)`
- absent → `~/.quill/server/<target_name>`

Target name from `manifest.target ?? "paper"`.

## Setup phase (guards: skip if file exists)

| File | Source |
|------|--------|
| `~/.quill/server/<target>/plugins/Ink/scripts/` | `mkdir -p` |
| `~/.quill/server/<target>/plugins/Ink/plugins/` | `mkdir -p` |
| `paper-<version>-<build>.jar` | Download from Paper MC API, or copy from `manifest.server.jar` (relative to project dir) |
| `plugins/Ink.jar` | Download from `https://github.com/inklang/ink/releases/latest/download/Ink.jar` |
| `eula.txt` | Write `eula=true` if absent |
| `server.properties` | Write defaults if absent |

## Build phase

Call `Build::execute(ctx)` directly (not a subprocess).

## Deploy phase

- **Scripts**: copy all `target/ink/*.inkc` → `server_dir/plugins/Ink/scripts/` (clear scripts dir first)
- **Grammar JARs**: copy all `target/*.jar` → `server_dir/plugins/Ink/plugins/`

## Watch mode

Watch paths: `src/`, `scripts/`, `runtime/src/` (only those that exist).

Use `notify` crate with 300ms debounce. On change:
1. Kill server (SIGTERM, then SIGKILL after 5s)
2. Sleep 2s (Windows socket release)
3. `Build::execute(ctx)`
4. Deploy
5. Spawn server

**Crash handling**: if server exits in watch mode (not shutting down), treat as crash with exponential backoff (min 2s, max 30s).

## Shutdown

SIGINT handler: set `is_shutting_down = true`, kill server, exit 0.

---

## Error handling

- Java not found → `QuillError::RegistryAuth { message: "Java 17+ not found..." }`
- Paper download fails → `QuillError::DownloadFailed`
- Build fails → print error, stay in watch loop waiting for next change
- Server spawn fails → `QuillError::ServerSpawnFailed`

---

## Testing

Unit tests for:
- `resolve_server_dir` (4 cases: default, with target, absolute path, relative path)
- `deploy_scripts` (clears and copies)
- `deploy_grammar_jars` (copies JARs)
- Setup file guards (eula.txt, server.properties)

No tests for: network downloads, server spawning (manual verification only).
