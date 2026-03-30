# Quill Run (Rust) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `quill run` for the Rust rewrite — build, deploy, and run a Paper dev server with watch mode.

**Architecture:** `Run` struct implements the `Command` trait. Calls `Build::execute(ctx)` directly for compilation. Uses `tokio::process::Command` for async server spawning. Uses `notify` crate for file watching. Setup is incremental (skip files already present).

**Tech Stack:** Rust (tokio, reqwest, notify, async-trait, thiserror)

---

## File Map

| File | Change |
|------|--------|
| `quill/Cargo.toml` | Add `notify` dependency |
| `quill/src/manifest/toml.rs` | Add `jar` and `path` fields to `ServerConfig` |
| `quill/src/error.rs` | Add `DownloadFailed` and `ServerSpawnFailed` variants |
| `quill/src/cli.rs` | Add `Run` variant to `Commands` enum |
| `quill/src/commands/mod.rs` | Add `pub mod run` + `Run` export + match arm |
| `quill/src/commands/run.rs` | **New** — `Run` struct with full `execute` |
| `quill/tests/commands/run.rs` | **New** — unit tests |

---

## Chunk 1: Manifest + Error + CLI Wiring

### Task 1: Extend `ServerConfig` with `jar` and `path`

**Files:**
- Modify: `quill/src/manifest/toml.rs`

- [ ] **Step 1: Add fields to `ServerConfig`**

In `quill/src/manifest/toml.rs`, change `ServerConfig` from:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct ServerConfig {
    pub paper: Option<String>,
}
```

to:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct ServerConfig {
    pub paper: Option<String>,
    pub jar: Option<String>,
    pub path: Option<String>,
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd quill && cargo check`
Expected: no errors (only ServerConfig change, no usages yet)

- [ ] **Step 3: Commit**

```bash
cd quill && git add src/manifest/toml.rs && git commit -m "feat(manifest): add jar and path fields to ServerConfig"
```

---

### Task 2: Add error variants

**Files:**
- Modify: `quill/src/error.rs`

- [ ] **Step 1: Add `DownloadFailed` and `ServerSpawnFailed` to `QuillError`**

Add before the closing `}` of the enum:

```rust
    #[error("download failed: {url}: {message}")]
    DownloadFailed { url: String, message: String },

    #[error("server spawn failed: {message}")]
    ServerSpawnFailed { message: String },
```

- [ ] **Step 2: Verify it compiles**

Run: `cd quill && cargo check`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd quill && git add src/error.rs && git commit -m "feat(error): add DownloadFailed and ServerSpawnFailed variants"
```

---

### Task 3: CLI registration

**Files:**
- Modify: `quill/src/cli.rs`
- Modify: `quill/src/commands/mod.rs`

- [ ] **Step 1: Add `Run` variant to `Commands` enum in `cli.rs`**

Add after the `Completions` variant (before the closing `}` of `Commands`):

```rust
    /// Build, deploy, and run a managed Paper dev server
    Run {
        /// Skip file watching (build + deploy + start once)
        #[arg(long)]
        no_watch: bool,
    },
```

- [ ] **Step 2: Add `pub mod run` and export to `commands/mod.rs`**

After the `unpublish` module line, add:

```rust
pub mod run;
```

Add `pub use run::Run;` after the other exports (around line 50).

- [ ] **Step 3: Add match arm to `commands::execute` in `commands/mod.rs`**

After the `Completions` arm:

```rust
        crate::cli::Commands::Run { no_watch } => {
            Run { no_watch: *no_watch }.execute(ctx).await
        }
```

- [ ] **Step 4: Verify it compiles**

Run: `cd quill && cargo check`
Expected: error about unused `run` module (not yet implemented) — this is fine

- [ ] **Step 5: Commit**

```bash
cd quill && git add src/cli.rs src/commands/mod.rs && git commit -m "feat(cli): add Run command variant"
```

---

## Chunk 2: `run.rs` Core Implementation

### Task 4: Create `run.rs` skeleton

**Files:**
- Create: `quill/src/commands/run.rs`
- Create: `quill/tests/commands/run.rs`

- [ ] **Step 1: Write failing test for `resolve_server_dir`**

Create `quill/tests/commands/run.rs`:

```rust
use tempfile::TempDir;
use std::path::PathBuf;

fn resolve_server_dir(project_dir: &str, manifest: &crate::manifest::PackageManifest) -> PathBuf {
    use std::path::Path;
    use std::env::var_os;

    let server_cfg = manifest.server.as_ref();
    let target_name = manifest.package.target.as_deref().unwrap_or("paper");

    if let Some(path) = server_cfg.and_then(|s| s.path.as_ref()) {
        if path.is_absolute() {
            return PathBuf::from(path);
        }
        return PathBuf::from(project_dir).join(path);
    }

    PathBuf::from(var_os("HOME").unwrap_or_default())
        .join(".quill")
        .join("server")
        .join(target_name)
}

#[test]
fn test_resolve_server_dir_default() {
    let manifest = crate::manifest::PackageManifest {
        package: crate::manifest::PackageInfo {
            name: "test".to_string(),
            version: "0.1.0".to_string(),
            package_type: None,
            description: None,
            author: None,
            homepage: None,
            repository: None,
            main: None,
            target: Some("paper".to_string()),
        },
        dependencies: Default::default(),
        grammar: None,
        build: None,
        runtime: None,
        server: None,
        targets: Default::default(),
    };

    let result = resolve_server_dir("/project", &manifest);
    let home = std::env::var("HOME").unwrap();
    assert_eq!(result, PathBuf::from(home).join(".quill").join("server").join("paper"));
}

#[test]
fn test_resolve_server_dir_absolute_path() {
    let manifest = crate::manifest::PackageManifest {
        package: crate::manifest::PackageInfo {
            name: "test".to_string(),
            version: "0.1.0".to_string(),
            package_type: None,
            description: None,
            author: None,
            homepage: None,
            repository: None,
            main: None,
            target: None,
        },
        dependencies: Default::default(),
        grammar: None,
        build: None,
        runtime: None,
        server: Some(crate::manifest::ServerConfig {
            paper: None,
            jar: None,
            path: Some("/custom/server".to_string()),
        }),
        targets: Default::default(),
    };

    let result = resolve_server_dir("/project", &manifest);
    assert_eq!(result, PathBuf::from("/custom/server"));
}

#[test]
fn test_resolve_server_dir_relative_path() {
    let manifest = crate::manifest::PackageManifest {
        package: crate::manifest::PackageInfo {
            name: "test".to_string(),
            version: "0.1.0".to_string(),
            package_type: None,
            description: None,
            author: None,
            homepage: None,
            repository: None,
            main: None,
            target: None,
        },
        dependencies: Default::default(),
        grammar: None,
        build: None,
        runtime: None,
        server: Some(crate::manifest::ServerConfig {
            paper: None,
            jar: None,
            path: Some("dev-server".to_string()),
        }),
        targets: Default::default(),
    };

    let result = resolve_server_dir("/my/project", &manifest);
    assert_eq!(result, PathBuf::from("/my/project").join("dev-server"));
}
```

- [ ] **Step 2: Run tests to confirm they pass**

Run: `cd quill && cargo test --test run`
Expected: PASS (these are unit tests of pure logic)

- [ ] **Step 3: Create `run.rs` with module signature and public helpers**

Create `quill/src/commands/run.rs`:

```rust
use async_trait::async_trait;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::signal::ctrl_c;
use tokio::time::sleep;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::manifest::PackageManifest;

/// Resolve the server directory from manifest config.
/// - manifest.server.path absolute → use as-is
/// - manifest.server.path relative → join with project_dir
/// - absent → ~/.quill/server/<target>
pub fn resolve_server_dir(project_dir: &Path, manifest: &PackageManifest) -> PathBuf {
    let target_name = manifest.package.target.as_deref().unwrap_or("paper");

    if let Some(path) = manifest.server.as_ref().and_then(|s| s.path.as_ref()) {
        if path.is_absolute() {
            return PathBuf::from(path);
        }
        return project_dir.join(path);
    }

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".quill")
        .join("server")
        .join(target_name)
}

/// Ensure server directory structure exists (plugins/Ink/scripts, plugins/Ink/plugins)
pub fn ensure_server_dir(server_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(server_dir.join("plugins").join("Ink").join("scripts"))?;
    fs::create_dir_all(server_dir.join("plugins").join("Ink").join("plugins"))?;
    Ok(())
}

/// Copy all .inkc files from src to dest (clears dest first)
pub fn deploy_scripts(server_dir: &Path, src_dir: &Path) -> std::io::Result<()> {
    let scripts_dir = server_dir.join("plugins").join("Ink").join("scripts");

    // Clear and recreate
    if scripts_dir.exists() {
        fs::remove_dir_all(&scripts_dir)?;
    }
    fs::create_dir_all(&scripts_dir)?;

    let src_scripts = src_dir;
    if !src_scripts.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(src_scripts)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|e| e == "inkc") {
            fs::copy(&path, scripts_dir.join(path.file_name().unwrap()))?;
        }
    }

    Ok(())
}

/// Copy grammar JARs from src_dir/*.jar to server plugins dir
pub fn deploy_grammar_jars(server_dir: &Path, src_dir: &Path) -> std::io::Result<()> {
    let plugins_dir = server_dir.join("plugins").join("Ink").join("plugins");
    fs::create_dir_all(&plugins_dir)?;

    if !src_dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(src_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|e| e == "jar") {
            fs::copy(&path, plugins_dir.join(path.file_name().unwrap()))?;
        }
    }

    Ok(())
}

pub struct Run {
    pub no_watch: bool,
}

impl Run {
    fn resolve_paper_jar(&self, manifest: &PackageManifest, server_dir: &Path) -> Result<PathBuf> {
        // If server.jar is configured, copy it
        if let Some(jar_path) = manifest.server.as_ref().and_then(|s| s.jar.as_ref()) {
            let src = manifest.package.name.parent().unwrap_or(&PathBuf::from(".")).join(jar_path);
            // jar is relative to project_dir
            let src = std::env::current_dir().unwrap_or_default().join(jar_path);
            let dest = server_dir.join(src.file_name().unwrap());
            fs::copy(&src, &dest).map_err(|e| QuillError::io_error("copy server.jar", e))?;
            return Ok(dest);
        }

        // Otherwise download from Paper MC API
        let version = manifest.server.as_ref()
            .and_then(|s| s.paper.as_ref())
            .unwrap_or(&"1.21.4".to_string());

        let builds_url = format!("https://api.papermc.io/v2/projects/paper/versions/{}/builds", version);

        let builds: PaperBuilds = reqwest::get(&builds_url)
            .await
            .map_err(|e| QuillError::DownloadFailed {
                url: builds_url.clone(),
                message: e.to_string(),
            })?
            .json()
            .await
            .map_err(|e| QuillError::DownloadFailed {
                url: builds_url,
                message: e.to_string(),
            })?;

        let build = builds.builds.last()
            .ok_or_else(|| QuillError::DownloadFailed {
                url: builds_url,
                message: format!("no builds for version {}", version),
            })?;

        let jar_name = format!("paper-{}-{}.jar", version, build.build);
        let jar_url = format!(
            "https://api.papermc.io/v2/projects/paper/versions/{}/builds/{}/downloads/{}",
            version, build.build, jar_name
        );

        let dest = server_dir.join(&jar_name);

        if !dest.exists() {
            println!("Downloading Paper {}...", version);
            let bytes = reqwest::get(&jar_url)
                .await
                .map_err(|e| QuillError::DownloadFailed { url: jar_url.clone(), message: e.to_string() })?
                .bytes()
                .await
                .map_err(|e| QuillError::DownloadFailed { url: jar_url.clone(), message: e.to_string() })?;

            fs::write(&dest, &bytes)
                .map_err(|e| QuillError::io_error("write paper jar", e))?;
            println!("Downloaded {}", jar_name);
        }

        Ok(dest)
    }

    fn check_java(&self) -> Result<()> {
        let output = Command::new("java")
            .arg("-version")
            .output()
            .await
            .map_err(|e| QuillError::ServerSpawnFailed {
                message: format!("failed to run java: {}", e),
            })?;

        if !output.status.success() {
            return Err(QuillError::ServerSpawnFailed {
                message: "Java not found. Install Java 17+ and ensure it is on your PATH.".to_string(),
            });
        }

        Ok(())
    }

    fn download_ink_jar(&self, server_dir: &Path) -> Result<PathBuf> {
        let ink_jar = server_dir.join("plugins").join("Ink.jar");

        if ink_jar.exists() {
            return Ok(ink_jar);
        }

        println!("Downloading Ink.jar...");
        let bytes = reqwest::get("https://github.com/inklang/ink/releases/latest/download/Ink.jar")
            .await
            .map_err(|e| QuillError::DownloadFailed {
                url: "https://github.com/inklang/ink/releases/latest/download/Ink.jar".to_string(),
                message: e.to_string(),
            })?
            .bytes()
            .await
            .map_err(|e| QuillError::DownloadFailed {
                url: "https://github.com/inklang/ink/releases/latest/download/Ink.jar".to_string(),
                message: e.to_string(),
            })?;

        fs::write(&ink_jar, &bytes)
            .map_err(|e| QuillError::io_error("write ink jar", e))?;
        println!("Downloaded Ink.jar");

        Ok(ink_jar)
    }

    fn write_eula_if_absent(&self, server_dir: &Path) -> std::io::Result<()> {
        let eula = server_dir.join("eula.txt");
        if !eula.exists() {
            fs::write(&eula, "eula=true\n")?;
        }
        Ok(())
    }

    fn write_props_if_absent(&self, server_dir: &Path) -> std::io::Result<()> {
        let props = server_dir.join("server.properties");
        if !props.exists() {
            fs::write(&props, "online-mode=false\nserver-port=25565\n")?;
        }
        Ok(())
    }

    async fn kill_server(&self, mut child: tokio::process::Child) {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

#[derive(serde::Deserialize)]
struct PaperBuilds {
    builds: Vec<PaperBuild>,
}

#[derive(serde::Deserialize)]
struct PaperBuild {
    build: u32,
}

#[async_trait]
impl Command for Run {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-package.toml"),
            }
        })?;

        let server_dir = resolve_server_dir(&ctx.project_dir, manifest);

        println!("Server directory: {}", server_dir.display());

        // Java check
        self.check_java()?;

        // Setup server directory
        ensure_server_dir(&server_dir).map_err(|e| QuillError::io_error("create server dir", e))?;

        let paper_jar = self.resolve_paper_jar(manifest, &server_dir)?;
        self.download_ink_jar(&server_dir)?;
        self.write_eula_if_absent(&server_dir).map_err(|e| QuillError::io_error("write eula", e))?;
        self.write_props_if_absent(&server_dir).map_err(|e| QuillError::io_error("write props", e))?;

        println!("Using Paper JAR: {}", paper_jar.display());

        // Build (shell out to Build command)
        println!("Building...");
        let build_cmd = crate::commands::build::Build {
            output: Some(ctx.project_dir.join("target").join("ink")),
            target: None,
        };
        build_cmd.execute(ctx).await?;

        // Deploy
        let output_dir = ctx.project_dir.join("target").join("ink");
        deploy_scripts(&server_dir, &output_dir)
            .map_err(|e| QuillError::io_error("deploy scripts", e))?;
        deploy_grammar_jars(&server_dir, &output_dir)
            .map_err(|e| QuillError::io_error("deploy jars", e))?;

        // Spawn server
        let mut child = Command::new("java")
            .args(&["-jar", paper_jar.to_str().unwrap(), "--nogui"])
            .current_dir(&server_dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| QuillError::ServerSpawnFailed { message: e.to_string() })?;

        if self.no_watch {
            let status = child.wait().await
                .map_err(|e| QuillError::ServerSpawnFailed { message: e.to_string() })?;
            std::process::exit(status.code().unwrap_or(0));
        }

        // Watch mode
        let mut is_shutting_down = false;
        let mut redeploy_in_progress = false;
        let mut restart_backoff_ms = 2000u64;

        let server_dir_clone = server_dir.clone();
        let output_dir_clone = output_dir.clone();
        let ctx_clone = ctx.clone();

        // Watch for file changes
        let watch_paths: Vec<PathBuf> = ["src", "scripts", "runtime/src"]
            .iter()
            .map(|d| ctx.project_dir.join(d))
            .filter(|p| p.exists())
            .collect();

        if !watch_paths.is_empty() {
            let (tx, mut rx) = tokio::sync::mpsc::channel(1);

            // Spawn watcher task
            let tx_clone = tx.clone();
            tokio::spawn(async move {
                use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
                let (notify_tx, notify_rx) = std::sync::mpsc::channel();
                let mut watcher = RecommendedWatcher::new(
                    move |res: Result<notify::Event, notify::Error>| {
                        let _ = notify_tx.send(res);
                    },
                    Config::default(),
                ).unwrap();

                for path in &watch_paths {
                    let _ = watcher.watch(path, RecursiveMode::Recursive);
                }

                let mut debounce = false;
                loop {
                    match notify_rx.recv_timeout(Duration::from_millis(300)) {
                        Ok(Ok(event)) => {
                            if !event.paths.is_empty() {
                                if !debounce {
                                    debounce = true;
                                    let _ = tx_clone.send(()).await;
                                }
                            }
                        }
                        Ok(Err(e)) => eprintln!("Watch error: {:?}", e),
                        Err(_) => break,
                    }
                }
            });

            // Spawn ctrl-c handler
            let tx_clone2 = tx.clone();
            tokio::spawn(async move {
                ctrl_c().await.ok();
                let _ = tx_clone2.send(()).await;
            });

            loop {
                tokio::select! {
                    _ = rx.recv() => {
                        if is_shutting_down { break; }
                        if redeploy_in_progress { continue; }

                        redeploy_in_progress = true;
                        is_shutting_down = true; // prevent restart loop
                        let _ = child.kill().await;
                        let _ = child.wait().await;

                        // Rebuild
                        let build_cmd = crate::commands::build::Build {
                            output: Some(ctx_clone.project_dir.join("target").join("ink")),
                            target: None,
                        };
                        if build_cmd.execute(&ctx_clone).await.is_ok() {
                            deploy_scripts(&server_dir_clone, &output_dir_clone).ok();
                            deploy_grammar_jars(&server_dir_clone, &output_dir_clone).ok();

                            child = Command::new("java")
                                .args(&["-jar", paper_jar.to_str().unwrap(), "--nogui"])
                                .current_dir(&server_dir_clone)
                                .stdout(Stdio::inherit())
                                .stderr(Stdio::inherit())
                                .spawn()
                                .map_err(|e| QuillError::ServerSpawnFailed { message: e.to_string() }).unwrap();
                        }

                        is_shutting_down = false;
                        redeploy_in_progress = false;
                    }
                    status = child.wait() => {
                        match status {
                            Ok(exit) => {
                                if !is_shutting_down {
                                    // Server exited — restart with backoff
                                    println!("\nServer exited (code {:?}) — restarting in {}ms...", exit.code(), restart_backoff_ms);
                                    sleep(Duration::from_millis(restart_backoff_ms)).await;

                                    // Rebuild
                                    let build_cmd = crate::commands::build::Build {
                                        output: Some(ctx_clone.project_dir.join("target").join("ink")),
                                        target: None,
                                    };
                                    let _ = build_cmd.execute(&ctx_clone).await;
                                    deploy_scripts(&server_dir_clone, &output_dir_clone).ok();
                                    deploy_grammar_jars(&server_dir_clone, &output_dir_clone).ok();

                                    child = Command::new("java")
                                        .args(&["-jar", paper_jar.to_str().unwrap(), "--nogui"])
                                        .current_dir(&server_dir_clone)
                                        .stdout(Stdio::inherit())
                                        .stderr(Stdio::inherit())
                                        .spawn()
                                        .map_err(|e| QuillError::ServerSpawnFailed { message: e.to_string() }).unwrap();

                                    restart_backoff_ms = (restart_backoff_ms * 2).min(30_000);
                                }
                            }
                            Err(e) => {
                                eprintln!("Server wait error: {}", e);
                                break;
                            }
                        }
                    }
                }
            }
        } else {
            // No watch paths — just wait for server
            let _ = child.wait().await;
        }

        Ok(())
    }
}
```

Note: The above implementation uses `ctx.clone()` which requires `Clone` on `Context`. If `Context` doesn't implement `Clone`, extract only the fields you need (`project_dir`, `verbose`, `quiet`) into a local struct for the watch loop.

- [ ] **Step 4: Verify compilation — first pass**

Run: `cd quill && cargo check 2>&1`
Expected: multiple errors (expected — we'll fix them)

Common issues to fix:
1. `resolve_server_dir` — `dirs::home_dir()` requires `dirs` crate (add to Cargo.toml) OR use `std::env::var("HOME")`
2. `ctx.clone()` — `Context` may not implement `Clone`
3. `manifest.package.name.parent()` — `name` is `String`, not `Path`
4. `notify` not in Cargo.toml
5. `PackageManifest` field access: `manifest.package.target` → `manifest.package.target` (already correct)

Fix each error iteratively.

- [ ] **Step 5: Fix errors iteratively until cargo check passes**

Run: `cd quill && cargo check 2>&1 | head -50`
Fix errors one by one.

- [ ] **Step 6: Run tests**

Run: `cd quill && cargo test --test run`
Expected: PASS for unit tests

- [ ] **Step 7: Commit**

```bash
cd quill && git add src/commands/run.rs tests/commands/run.rs && git commit -m "feat(run): implement quill run command with setup, deploy, watch, and server management"
```

---

## Manual Verification Checklist

After all chunks complete, verify end-to-end:

- [ ] `cargo run -- run --help` → shows `quill run` with `--no-watch` option
- [ ] `cargo run -- run` in a project with Java → server starts
- [ ] `cargo run -- run --no-watch` → server runs without watching, Ctrl-C exits cleanly
- [ ] Edit a `.ink` file in watch mode → server restarts with new scripts
- [ ] `quill run` first run → downloads Paper JAR + Ink.jar
- [ ] `quill run` second run → skips download (files exist)
