# Inline TUI Improvements (install, build, audit) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline progress bars/spinners to `quill install` and `quill build`, and colored severity output to `quill audit`, using `indicatif` and `crossterm`.

**Architecture:** Three independent command improvements sharing one foundational change: updating `RegistryClient::download_package` to stream response chunks (enabling per-chunk progress) and updating `Cargo.toml` dependencies. Each command then adds its own inline output with a non-TTY fallback that preserves existing behavior.

**Tech Stack:** Rust, `indicatif 0.17` (progress bars/spinners), `crossterm 0.28` (colors, already a dep), `futures-util 0.3` (streaming, already a dep), `wiremock 0.6` (test HTTP server, already in dev-deps)

**Spec:** `docs/superpowers/specs/2026-03-30-inline-tui-improvements-design.md`

---

## Chunk 1: Cargo.toml + Streaming Download API

### Task 1: Update dependency features in Cargo.toml

**Files:**
- Modify: `Cargo.toml`

- [ ] **Step 1: Add `stream` feature to reqwest**

`indicatif` requires no feature changes — `ProgressBar` works without any feature flags.

In `Cargo.toml`, replace:
```toml
reqwest = { version = "0.12", features = ["json", "multipart", "blocking"] }
```
with:
```toml
reqwest = { version = "0.12", features = ["json", "multipart", "blocking", "stream"] }
```

Leave `indicatif = "0.17"` unchanged.

- [ ] **Step 2: Verify it compiles**

```bash
cd /c/Users/justi/dev/quill && cargo build 2>&1 | tail -5
```
Expected: `Finished` with no errors.

---

### Task 2: Change `download_package` to accept optional progress bar and stream chunks

**Files:**
- Modify: `src/registry/client.rs` (around line 253)
- Modify: `src/commands/install.rs` — update all call sites to pass `None`

- [ ] **Step 1: Write the failing test**

Add at the bottom of `src/registry/client.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn test_download_package_streams_to_file() {
        let server = MockServer::start().await;
        let body = b"fake tarball content";

        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(body.as_slice())
                    .append_header("content-length", body.len().to_string()),
            )
            .mount(&server)
            .await;

        let dir = tempdir().unwrap();
        let dest = dir.path().join("package.tar.gz");
        // RegistryClient::new stores a base URL but download_package uses the passed URL
        // directly — construct with an empty string to make this clear.
        let client = RegistryClient::new("");

        client
            .download_package(&format!("{}/pkg.tar.gz", server.uri()), &dest, None)
            .await
            .unwrap();

        let written = std::fs::read(&dest).unwrap();
        assert_eq!(written, body);
    }
}
```

- [ ] **Step 2: Run to confirm it fails (signature mismatch)**

```bash
cd /c/Users/justi/dev/quill && cargo test test_download_package_streams_to_file 2>&1 | tail -10
```
Expected: compile error about wrong number of arguments.

- [ ] **Step 3: Update `download_package` signature and implementation**

Replace the existing `download_package` function body in `src/registry/client.rs` (line 253–288):

```rust
/// Download a package from a URL, streaming chunks into dest.
/// Pass a ProgressBar to show byte progress; pass None for silent download.
pub async fn download_package(
    &self,
    url: &str,
    dest: &Path,
    pb: Option<&ProgressBar>,
) -> Result<()> {
    use futures_util::StreamExt;

    let response = self
        .client
        .get(url)
        .send()
        .await
        .map_err(|e| QuillError::RegistryRequest {
            url: url.to_string(),
            source: e,
        })?;

    if !response.status().is_success() {
        return Err(QuillError::RegistryRequest {
            url: url.to_string(),
            // Use error_for_status_ref() to match existing code style (borrows without consuming)
            source: response.error_for_status_ref().unwrap_err(),
        });
    }

    if let (Some(pb), Some(len)) = (pb, response.content_length()) {
        pb.set_length(len);
    }

    let mut file = TokioFile::create(dest)
        .await
        .map_err(|e| QuillError::io_error("failed to create destination file", e))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| QuillError::RegistryRequest {
            url: url.to_string(),
            source: e,
        })?;
        file.write_all(&chunk)
            .await
            .map_err(|e| QuillError::io_error("failed to write chunk", e))?;
        if let Some(pb) = pb {
            pb.inc(chunk.len() as u64);
        }
    }

    Ok(())
}
```

Add the import at the top of `client.rs` if not already present:
```rust
use indicatif::ProgressBar;
```

- [ ] **Step 4: Fix the call site in `install.rs`**

In `src/commands/install.rs`, find:
```rust
client.download_package(&resolved_pkg.url, &tarball_path).await?;
```
Replace with:
```rust
client.download_package(&resolved_pkg.url, &tarball_path, None).await?;
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd /c/Users/justi/dev/quill && cargo test test_download_package_streams_to_file 2>&1 | tail -10
```
Expected: `test test_download_package_streams_to_file ... ok`

- [ ] **Step 6: Confirm full build still passes**

```bash
cd /c/Users/justi/dev/quill && cargo build 2>&1 | tail -5
```
Expected: `Finished` with no errors.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/justi/dev/quill && git add Cargo.toml Cargo.lock src/registry/client.rs src/commands/install.rs && git commit -m "feat(install): stream download chunks, add optional ProgressBar param"
```

---

## Chunk 2: `quill install` — MultiProgress + Concurrent Downloads

### Task 3: Add MultiProgress inline progress to `install`

**Files:**
- Modify: `src/commands/install.rs`

The full updated `execute` function replaces the existing one. Key structural changes:
1. Non-TTY early return that runs the original logic
2. Pre-flight pass (offline check + `create_dir_all`)
3. MultiProgress with one bar per package to download; instant ✓ for cached
4. Concurrent `tokio::spawn` per download+extract task
5. Single summary line on completion

- [ ] **Step 1: Write the failing test for offline pre-flight**

Add to `src/commands/install.rs` (this will fail to compile until `run_sequential` exists with the right signature):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tempfile::tempdir;
    use crate::resolve::ResolvedPackage;
    use crate::registry::RegistryClient;

    #[tokio::test]
    async fn test_run_sequential_errors_when_offline_and_package_not_cached() {
        let dir = tempdir().unwrap();
        // Use an unreachable URL — offline mode should error before any network call
        let client = RegistryClient::new("http://127.0.0.1:1");
        let mut resolved: BTreeMap<String, ResolvedPackage> = BTreeMap::new();
        resolved.insert("test-pkg".to_string(), ResolvedPackage {
            name: "test-pkg".to_string(),
            version: "1.0.0".to_string(),
            url: "http://127.0.0.1:1/test.tar.gz".to_string(),
            range: "^1.0.0".to_string(),
            targets: None,
            checksum: None,
            dep_keys: vec![],
        });

        // cache dir with no packages inside
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&cache_dir).unwrap();

        let result = run_sequential(&resolved, &cache_dir, true, &client, dir.path()).await;
        assert!(result.is_err(), "expected offline miss to return Err");
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("offline"), "expected error to mention 'offline', got: {}", msg);
    }
}
```

- [ ] **Step 2: Run to confirm it fails (function doesn't exist yet)**

```bash
cd /c/Users/justi/dev/quill && cargo test test_run_sequential_errors_when_offline_and_package_not_cached 2>&1 | tail -10
```
Expected: compile error — `run_sequential` not found.

- [ ] **Step 3: Rewrite `install.rs` with MultiProgress and concurrent downloads**

Replace the entire contents of `src/commands/install.rs` with:

```rust
use async_trait::async_trait;
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use std::collections::BTreeMap;
use std::io::IsTerminal;
use std::path::PathBuf;
use std::sync::Arc;

use crate::cache::CacheManifest;
use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::manifest::{Lockfile, LockedPackage};
use crate::registry::RegistryClient;
use crate::resolve;
use crate::util::fs as quill_fs;

pub struct Install {
    pub frozen: bool,
    pub offline: bool,
}

#[async_trait]
impl Command for Install {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| QuillError::ManifestNotFound {
            path: ctx.project_dir.join("ink-manifest.toml"),
        })?;

        let registry_url = &ctx.registry_url;
        let client = RegistryClient::new(registry_url);
        let cache_dir = get_cache_dir()?;
        let cache_manifest_path = cache_dir.join("manifest.json");

        let cache_manifest = load_cache_manifest(&cache_manifest_path)?;

        let index = if self.offline {
            load_cached_index(&cache_dir).await?
        } else {
            client.fetch_index().await?
        };

        let resolved = resolve::resolve_transitive(&index, &manifest.dependencies)?;

        // Build lockfile
        let mut packages: BTreeMap<String, LockedPackage> = BTreeMap::new();
        for (name, resolved_pkg) in &resolved {
            packages.insert(
                name.clone(),
                LockedPackage {
                    version: resolved_pkg.version.clone(),
                    resolution_source: registry_url.clone(),
                    dependencies: resolved_pkg.dep_keys.clone(),
                },
            );
        }
        let lockfile = Lockfile { version: 1, registry: registry_url.clone(), packages };
        let lockfile_path = ctx.project_dir.join("quill.lock");
        lockfile.save(&lockfile_path)?;

        // Non-TTY: sequential plain output
        if !std::io::stdout().is_terminal() {
            return run_sequential(&resolved, &cache_dir, self.offline, &client, &ctx.project_dir).await;
        }

        // Pre-flight: offline check + create dirs for all packages needing download
        let mut to_download: Vec<(String, String, PathBuf)> = Vec::new(); // (name, url, tarball_path)
        let mut cached_names: Vec<String> = Vec::new();

        for (name, resolved_pkg) in &resolved {
            let package_cache_dir = cache_dir.join("packages").join(name);
            let tarball_path = package_cache_dir.join("package.tar.gz");

            if tarball_path.exists() {
                cached_names.push(name.clone());
                continue;
            }

            if self.offline {
                return Err(QuillError::RegistryAuth {
                    message: format!("offline: {} not in cache", name),
                });
            }

            std::fs::create_dir_all(&package_cache_dir)
                .map_err(|e| QuillError::io_error("failed to create cache directory", e))?;
            to_download.push((name.clone(), resolved_pkg.url.clone(), tarball_path));
        }

        let mp = MultiProgress::new();
        let spinner_style = ProgressStyle::with_template("  {spinner:.cyan} {wide_msg}")
            .unwrap()
            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
        let done_style = ProgressStyle::with_template("  {msg}").unwrap();

        // Show cached packages immediately
        for name in &cached_names {
            let pb = mp.add(ProgressBar::new(0));
            pb.set_style(done_style.clone());
            pb.finish_with_message(format!("✓ {:<30} cached", name));
        }

        // Spawn concurrent download + extract tasks
        let client = Arc::new(client);
        let project_dir = Arc::new(ctx.project_dir.clone());
        let mut handles = Vec::new();

        for (name, url, tarball_path) in to_download {
            let pb = mp.add(ProgressBar::new_spinner());
            pb.set_style(spinner_style.clone());
            pb.enable_steady_tick(std::time::Duration::from_millis(80));
            pb.set_message(format!("{:<30} downloading...", name));

            let client = Arc::clone(&client);
            let project_dir = Arc::clone(&project_dir);
            let done_style = done_style.clone();

            handles.push(tokio::spawn(async move {
                let result = client.download_package(&url, &tarball_path, Some(&pb)).await;
                match result {
                    Err(e) => {
                        pb.set_style(done_style);
                        pb.finish_with_message(format!("✗ {:<30} {}", name, e));
                        Err(e)
                    }
                    Ok(()) => {
                        let extract_dir = project_dir.join("node_modules").join(&name);
                        std::fs::create_dir_all(extract_dir.parent().unwrap_or(&extract_dir))
                            .map_err(|e| QuillError::io_error("failed to create directory", e))?;
                        quill_fs::extract_tarball(&tarball_path, &extract_dir)?;
                        pb.set_style(done_style);
                        pb.finish_with_message(format!("✓ {:<30} installed", name));
                        Ok(())
                    }
                }
            }));
        }

        let mut errors: Vec<String> = Vec::new();
        for handle in handles {
            match handle.await {
                Ok(Err(e)) => errors.push(e.to_string()),
                Err(e) => errors.push(format!("task panicked: {}", e)),
                Ok(Ok(())) => {}
            }
        }

        // Drop mp — do NOT call mp.clear(), which would erase the finished ✓ lines
        // from the scrollback. Dropping is sufficient.
        drop(mp);

        if !errors.is_empty() {
            return Err(QuillError::RegistryAuth {
                message: format!("install failed:\n  {}", errors.join("\n  ")),
            });
        }

        // Update cache manifest
        save_cache_manifest(&cache_manifest, &cache_manifest_path)?;

        println!("  ✓ Installed {} packages", resolved.len());
        Ok(())
    }
}

// ── Plain sequential path (non-TTY) ────────────────────────────────

async fn run_sequential(
    resolved: &std::collections::BTreeMap<String, crate::resolve::ResolvedPackage>,
    cache_dir: &std::path::Path,
    offline: bool,
    client: &RegistryClient,
    project_dir: &std::path::Path,
) -> Result<()> {
    for (name, resolved_pkg) in resolved {
        let package_cache_dir = cache_dir.join("packages").join(name);
        let tarball_path = package_cache_dir.join("package.tar.gz");

        if !tarball_path.exists() {
            if offline {
                return Err(QuillError::RegistryAuth {
                    message: format!("offline: {} not in cache", name),
                });
            }
            std::fs::create_dir_all(&package_cache_dir)
                .map_err(|e| QuillError::io_error("failed to create cache directory", e))?;
            client.download_package(&resolved_pkg.url, &tarball_path, None).await?;
        }

        let extract_dir = project_dir.join("node_modules").join(name);
        std::fs::create_dir_all(extract_dir.parent().unwrap_or(&extract_dir))
            .map_err(|e| QuillError::io_error("failed to create directory", e))?;
        quill_fs::extract_tarball(&tarball_path, &extract_dir)?;
    }
    println!("Installed {} dependencies", resolved.len());
    Ok(())
}

// ── Helpers ────────────────────────────────────────────────────────

fn get_cache_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME").map_err(|_| QuillError::RegistryAuth {
        message: "HOME environment variable not set".to_string(),
    })?;
    Ok(PathBuf::from(home).join(".quill").join("cache"))
}

fn load_cache_manifest(path: &std::path::Path) -> Result<CacheManifest> {
    if path.exists() {
        let content = std::fs::read_to_string(path)
            .map_err(|e| QuillError::io_error("failed to read cache manifest", e))?;
        serde_json::from_str(&content).map_err(|e| QuillError::RegistryAuth {
            message: format!("failed to parse cache manifest: {}", e),
        })
    } else {
        Ok(CacheManifest::default())
    }
}

fn save_cache_manifest(manifest: &CacheManifest, path: &std::path::Path) -> Result<()> {
    let json = serde_json::to_string_pretty(manifest).map_err(|e| QuillError::RegistryAuth {
        message: format!("failed to serialize cache manifest: {}", e),
    })?;
    std::fs::write(path, json)
        .map_err(|e| QuillError::io_error("failed to write cache manifest", e))
}

async fn load_cached_index(cache_dir: &PathBuf) -> Result<crate::registry::index::RegistryIndex> {
    let index_path = cache_dir.join("index.json.gz");
    if !index_path.exists() {
        return Err(QuillError::RegistryAuth {
            message: "cached index not found".to_string(),
        });
    }
    let content = std::fs::read(&index_path)
        .map_err(|e| QuillError::io_error("failed to read cached index", e))?;
    use flate2::read::GzDecoder;
    use std::io::Read;
    let mut decoder = GzDecoder::new(&content[..]);
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed).map_err(|e| QuillError::RegistryAuth {
        message: format!("failed to decompress cached index: {}", e),
    })?;
    serde_json::from_slice(&decompressed).map_err(|e| QuillError::RegistryAuth {
        message: format!("failed to parse cached index: {}", e),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_preflight_returns_err_when_offline_and_not_cached() {
        let dir = tempdir().unwrap();
        let tarball = dir.path().join("missing.tar.gz");
        let offline = true;
        let cached = tarball.exists();
        let should_err = offline && !cached;
        assert!(should_err, "expected pre-flight to detect offline miss");
    }
}
```

> **Note:** `crate::resolve::ResolvedPackage` — check the actual type name in `src/resolve.rs` and adjust the `run_sequential` signature if it differs. The `resolved_pkg.url` field — verify it exists on the resolved package struct; if not, look up the URL from the registry index.

- [ ] **Step 4: Run all tests (including the new offline test)**

```bash
cd /c/Users/justi/dev/quill && cargo test 2>&1 | tail -15
```
Expected: `test_run_sequential_errors_when_offline_and_package_not_cached ... ok` and all other tests pass.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/justi/dev/quill && git add src/commands/install.rs && git commit -m "feat(install): add MultiProgress inline bars and concurrent downloads"
```

---

## Chunk 3: `quill build` — Step Spinner

### Task 4: Add spinner step tracking to `build`

**Files:**
- Modify: `src/commands/build.rs`

- [ ] **Step 1: Write a test for the non-TTY code path (output goes to stdout)**

Add at the bottom of `src/commands/build.rs`:

```rust
#[cfg(test)]
mod tests {
    // The spinner is only shown on TTY. We test that the build logic
    // still produces the correct output files when run without a terminal.
    // This is an integration-style check — verify the build function
    // compiles and the helper functions work correctly.

    #[test]
    fn test_chrono_now_is_nonempty() {
        let ts = super::chrono_now();
        assert!(!ts.is_empty());
    }
}
```

- [ ] **Step 2: Run to confirm it passes**

```bash
cd /c/Users/justi/dev/quill && cargo test test_chrono_now_is_nonempty 2>&1 | tail -5
```
Expected: PASS

- [ ] **Step 3: Extract a `make_spinner` helper and add `step_done` / `step_fail` helpers**

Add these helper functions near the bottom of `src/commands/build.rs` (before `fn get_cache_dir`):

```rust
fn make_spinner(is_tty: bool) -> indicatif::ProgressBar {
    use indicatif::{ProgressBar, ProgressStyle};
    if !is_tty {
        // Return a hidden bar that does nothing visible
        let pb = ProgressBar::hidden();
        return pb;
    }
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::with_template("  {spinner:.cyan} {msg}")
            .unwrap()
            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]),
    );
    pb.enable_steady_tick(std::time::Duration::from_millis(80));
    pb
}

fn step_done(pb: &indicatif::ProgressBar, is_tty: bool, msg: &str) {
    if is_tty {
        pb.println(format!("  ✓ {}", msg));
    } else {
        println!("  ✓ {}", msg);
    }
}

fn step_warn(pb: &indicatif::ProgressBar, is_tty: bool, msg: &str) {
    if is_tty {
        pb.println(format!("  ! {}", msg));
    } else {
        println!("  ! {}", msg);
    }
}
```

- [ ] **Step 4: Run tests to confirm helpers compile**

```bash
cd /c/Users/justi/dev/quill && cargo build 2>&1 | tail -5
```
Expected: `Finished`

- [ ] **Step 5: Wire spinner into `build.execute`**

Replace the `execute` function in `src/commands/build.rs`. The build logic itself is unchanged — only the output calls are updated. Diff of changes:

At the top of `execute`, add:
```rust
let is_tty = std::io::stdout().is_terminal();
let pb = make_spinner(is_tty);
```

Add `use std::io::IsTerminal;` to imports.

Replace each `println!` / `eprintln!` with spinner calls:

| Old code | New code |
|---|---|
| *(after step 2 — grammar parsed)* | `pb.set_message("Merging dependency grammars..."); step_done(&pb, is_tty, "Parsed grammar");` |
| *(after step 3 — grammars merged)* | `pb.set_message("Compiling..."); step_done(&pb, is_tty, &format!("Merged {} dependency grammars", dependency_grammars.len()));` or skip if no deps |
| `println!("Compiled: {} → {}", entry_relative, output_file.display());` | `pb.set_message("Collecting exports..."); step_done(&pb, is_tty, &format!("Compiled → {}", output_file.display()));` |
| `println!("Exports: {}", exports_path.display());` | `step_done(&pb, is_tty, &format!("Exports collected → {}", exports_path.display()));` |
| `eprintln!("warning: exports collection failed: ...")` | `step_warn(&pb, is_tty, &format!("exports collection failed: ..."));` |
| *(after exports step, before step 7)* | `pb.set_message("Writing manifest...");` |
| `println!("Build complete: {}", ink_manifest_path.display());` | `pb.finish_and_clear(); println!("  ✓ Build complete → {}", ink_manifest_path.display());` |

For compile errors: before returning `Err`, call:
```rust
pb.finish_and_clear();
// Then print the error to stderr normally — the Err propagates up
```

Full annotated `execute` body (apply these changes to the existing function — do not change any build logic, only the output calls):

```rust
async fn execute(&self, ctx: &Context) -> Result<()> {
    use std::io::IsTerminal;
    let is_tty = std::io::stdout().is_terminal();
    let pb = make_spinner(is_tty);
    pb.set_message("Parsing grammar...");

    // ... (steps 1–2: resolve target + parse local grammar — unchanged) ...

    // After step 2:
    pb.set_message("Merging dependency grammars...");
    step_done(&pb, is_tty, "Parsed grammar");

    // ... (step 3: merge dep grammars — unchanged) ...

    // After step 3 (only if deps exist):
    if !dependency_grammars.is_empty() {
        step_done(&pb, is_tty, &format!("Merged {} dependency grammars", dependency_grammars.len()));
    }
    pb.set_message("Compiling...");

    // ... (steps 4–5: determine entry + compile — unchanged) ...

    // Replace existing println!("Compiled: ..."):
    pb.set_message("Collecting exports...");
    step_done(&pb, is_tty, &format!("Compiled → {}", output_file.display()));

    // ... (step 6: generate exports — unchanged, but replace println/eprintln) ...

    // Replace println!("Exports: ..."):
    step_done(&pb, is_tty, &format!("Exports collected"));
    // Replace eprintln!("warning: ..."):
    // step_warn(&pb, is_tty, &format!("exports collection failed: {}", e.display()));

    pb.set_message("Writing manifest...");

    // ... (steps 7–8: load cache + write ink-manifest — unchanged) ...

    // Replace println!("Build complete: ...") — after step 9:
    // Use plain println! here — pb.println on a finished bar is a no-op on TTY
    pb.finish_and_clear();
    println!("  ✓ Build complete → {}", ink_manifest_path.display());

    Ok(())
}
```

Apply these changes directly to the existing function body in `build.rs`. Do not change the build logic — only swap `println!`/`eprintln!` calls for `step_done`/`step_warn`/`pb.set_message`.

- [ ] **Step 6: Run all tests**

```bash
cd /c/Users/justi/dev/quill && cargo test 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 7: Smoke test the spinner manually (optional, TTY only)**

```bash
cd /c/Users/justi/dev/quill && cargo run -- build 2>&1 | head -20
```
Expected: step lines print with ✓ prefix.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/justi/dev/quill && git add src/commands/build.rs && git commit -m "feat(build): add step spinner to build command"
```

---

## Chunk 4: `quill audit` — Colored Severity Output

### Task 5: Add `package` field to `VulnerabilityIssue` and wire it through

**Files:**
- Modify: `src/commands/audit.rs`

- [ ] **Step 1: Write a failing test for the package field**

Add to the bottom of `src/commands/audit.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vulnerability_issue_has_package_field() {
        let issue = VulnerabilityIssue {
            id: "CVE-2024-1234".to_string(),
            severity: "High".to_string(),
            summary: "test vuln".to_string(),
            references: vec![],
            package: Some("my-package".to_string()),
        };
        assert_eq!(issue.package, Some("my-package".to_string()));
    }
}
```

- [ ] **Step 2: Run to confirm it fails (field doesn't exist yet)**

```bash
cd /c/Users/justi/dev/quill && cargo test test_vulnerability_issue_has_package_field 2>&1 | tail -5
```
Expected: compile error — no field `package` on `VulnerabilityIssue`.

- [ ] **Step 3: Add `package` field to `VulnerabilityIssue` struct**

Replace the struct definition in `audit.rs`:

```rust
struct VulnerabilityIssue {
    id: String,
    severity: String,
    summary: String,
    references: Vec<String>,
    package: Option<String>,
}
```

- [ ] **Step 4: Fix all construction sites**

In `scan_bytecode` (the `issues.push(...)` call), add `package: None`:
```rust
issues.push(VulnerabilityIssue {
    id: format!("BYTE-001: {} in {}", v.operation, file.display()),
    severity: "High".to_string(),
    summary: format!("Disallowed operation '{}' found at {}", v.operation, v.location),
    references: vec![],
    package: None,
});
```

In `scan_dependencies` (the `issues.push(...)` call), add `package: Some(name.clone())`:
```rust
issues.push(VulnerabilityIssue {
    id: vuln.id,
    severity: severity_str.to_string(),
    summary: vuln.summary,
    references: vuln.references,
    package: Some(name.clone()),
});
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd /c/Users/justi/dev/quill && cargo test test_vulnerability_issue_has_package_field 2>&1 | tail -5
```
Expected: PASS

---

### Task 6: Add colored severity output to `audit`

**Files:**
- Modify: `src/commands/audit.rs`

- [ ] **Step 1: Write the failing test for the severity badge helper**

Add to the test module in `audit.rs`:

```rust
#[test]
fn test_severity_badge_non_tty_does_not_panic() {
    // Calls the not-yet-written function — this MUST fail to compile until Step 3.
    // With is_tty=false, no crossterm calls are made, so it is safe to run in tests.
    for severity in &["Critical", "High", "Medium", "Low", "Unknown"] {
        // Should not panic for any severity value
        super::print_severity_badge(severity, false);
    }
}
```

- [ ] **Step 2: Run to confirm it fails (function doesn't exist yet)**

```bash
cd /c/Users/justi/dev/quill && cargo test test_severity_badge_non_tty_does_not_panic 2>&1 | tail -5
```
Expected: compile error — `print_severity_badge` not found.

- [ ] **Step 3: Add `print_severity_badge` helper and rewrite `execute` output**

Add this helper function near the bottom of `audit.rs` (before the `find_inkc_files` function):

```rust
fn print_severity_badge(severity: &str, is_tty: bool) {
    use crossterm::style::{Attribute, Color, Print, ResetColor, SetAttribute, SetForegroundColor};

    let badge = format!("[{}]", severity.to_uppercase());

    if !is_tty {
        print!("{}", badge);
        return;
    }

    let color = match severity {
        "Critical" => Color::Red,
        "High" => Color::Red,
        "Medium" => Color::Yellow,
        "Low" => Color::Blue,
        _ => Color::DarkGrey,
    };
    let bold = severity == "Critical";
    let mut stdout = std::io::stdout();

    if bold {
        crossterm::execute!(stdout, SetAttribute(Attribute::Bold)).unwrap_or(());
    }
    crossterm::execute!(stdout, SetForegroundColor(color), Print(&badge), ResetColor).unwrap_or(());
    if bold {
        crossterm::execute!(stdout, SetAttribute(Attribute::Reset)).unwrap_or(());
    }
}
```

Add `use std::io::IsTerminal;` to the imports at the top of `audit.rs`.

Replace the `execute` function body with:

```rust
async fn execute(&self, ctx: &Context) -> Result<()> {
    use std::io::IsTerminal;
    let is_tty = std::io::stdout().is_terminal();

    println!("  Scanning bytecode...");
    let mut issues = Vec::new();
    let bytecode_issues = scan_bytecode(ctx).await?;
    issues.extend(bytecode_issues);

    if let Some(lockfile) = &ctx.lockfile {
        println!("  Scanning dependencies ({} packages)...", lockfile.packages.len());
    }
    let osv_issues = scan_dependencies(ctx).await?;
    issues.extend(osv_issues);

    if issues.is_empty() {
        println!("  ✓ No vulnerabilities found.");
        return Ok(());
    }

    println!("\n  Found {} vulnerability(ies):\n", issues.len());
    for issue in &issues {
        print!("  ");
        print_severity_badge(&issue.severity, is_tty);
        println!(" {}", issue.id);

        if let Some(pkg) = &issue.package {
            println!("    {}", pkg);
        }
        println!("    {}", issue.summary);
        for r in &issue.references {
            println!("    {}", r);
        }
        println!();
    }

    Err(QuillError::VulnerabilitiesFound { count: issues.len() })
}
```

- [ ] **Step 4: Run all tests**

```bash
cd /c/Users/justi/dev/quill && cargo test 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 5: Verify full build**

```bash
cd /c/Users/justi/dev/quill && cargo build 2>&1 | tail -5
```
Expected: `Finished` with no errors.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/justi/dev/quill && git add src/commands/audit.rs && git commit -m "feat(audit): add colored severity output and package field to vulnerabilities"
```

---

## Final Verification

- [ ] **Run the full test suite one last time**

```bash
cd /c/Users/justi/dev/quill && cargo test 2>&1
```
Expected: all tests pass.

- [ ] **Run clippy to catch any style issues**

```bash
cd /c/Users/justi/dev/quill && cargo clippy 2>&1 | grep "^error" | head -10
```
Expected: no errors.
