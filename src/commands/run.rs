use async_trait::async_trait;
use notify::{recommended_watcher, Event as NotifyEvent, RecursiveMode, Watcher};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;
use std::time::Duration;
use tokio::process::{Child, Command as TokioCommand};

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::manifest::toml::PackageManifest;

// ---------------------------------------------------------------------------
// Public helper functions (separated for testability)
// ---------------------------------------------------------------------------

/// Return the home directory using the same pattern as `build.rs`.
fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string()))
}

/// Resolve the server directory from manifest config.
///
/// - `server.path` absolute  -> use as-is
/// - `server.path` relative  -> join with `project_dir`
/// - absent                   -> `~/.quill/server/{package_name}`
pub fn resolve_server_dir(project_dir: &Path, manifest: &PackageManifest) -> PathBuf {
    if let Some(ref server) = manifest.server {
        if let Some(ref p) = server.path {
            let path = PathBuf::from(p);
            if path.is_absolute() {
                return path;
            } else {
                return project_dir.join(&path);
            }
        }
    }
    home_dir().join(".quill").join("server").join(&manifest.package.name)
}

/// Ensure the server directory structure exists:
///
/// ```text
/// {server_dir}/
///   plugins/
///     Ink/
///       plugins/
///       scripts/
/// ```
pub fn ensure_server_dir(server_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(server_dir.join("plugins").join("Ink").join("plugins"))?;
    fs::create_dir_all(server_dir.join("plugins").join("Ink").join("scripts"))?;
    Ok(())
}

/// Deploy compiled `.inkc` files from `output_dir` into the server scripts dir.
///
/// Copies every `**/*.inkc` file, preserving relative directory structure under
/// `{server_dir}/plugins/Ink/scripts/`.
pub fn deploy_scripts(server_dir: &Path, output_dir: &Path) -> std::io::Result<()> {
    let scripts_dir = server_dir.join("plugins").join("Ink").join("scripts");
    fs::create_dir_all(&scripts_dir)?;

    if !output_dir.exists() {
        return Ok(());
    }

    visit_dirs(output_dir, &mut |entry| {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("inkc") {
            let relative = path.strip_prefix(output_dir).unwrap_or(&path);
            let dest = scripts_dir.join(relative);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&path, &dest)?;
        }
        Ok(())
    })
}

/// Deploy grammar `.jar` files from `output_dir` into the server Ink plugins dir.
///
/// Copies every `**/*.jar` file to `{server_dir}/plugins/Ink/plugins/`, flattening
/// the directory structure (jars go directly into the plugins directory).
pub fn deploy_grammar_jars(server_dir: &Path, output_dir: &Path) -> std::io::Result<()> {
    let plugins_dir = server_dir.join("plugins").join("Ink").join("plugins");
    fs::create_dir_all(&plugins_dir)?;

    if !output_dir.exists() {
        return Ok(());
    }

    visit_dirs(output_dir, &mut |entry| {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jar") {
            let file_name = path.file_name().unwrap_or_default();
            let dest = plugins_dir.join(file_name);
            fs::copy(&path, &dest)?;
        }
        Ok(())
    })
}

/// Recursively visit all entries in a directory tree, calling `cb` for each
/// `DirEntry`. Adapted from the Rust cookbook pattern.
fn visit_dirs(dir: &Path, cb: &mut dyn FnMut(&std::fs::DirEntry) -> std::io::Result<()>) -> std::io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                visit_dirs(&path, cb)?;
            } else {
                cb(&entry)?;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Run command
// ---------------------------------------------------------------------------

pub struct Run {
    pub no_watch: bool,
}

impl Run {
    /// Check that `java` is available on PATH.
    async fn check_java(&self) -> Result<()> {
        let output = TokioCommand::new("java")
            .arg("-version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| QuillError::ServerSpawnFailed {
                message: format!("java not found on PATH: {}", e),
            })?;

        if !output.status.success() {
            return Err(QuillError::ServerSpawnFailed {
                message: "java -version exited with non-zero status".to_string(),
            });
        }
        Ok(())
    }

    /// Resolve (and download if necessary) the Paper JAR for the configured
    /// Minecraft version. Returns the path to the JAR on disk.
    async fn resolve_paper_jar(
        &self,
        manifest: &PackageManifest,
        server_dir: &Path,
    ) -> Result<PathBuf> {
        // If user specified a custom JAR, use it directly.
        if let Some(ref server) = manifest.server {
            if let Some(ref jar) = server.jar {
                let jar_path = PathBuf::from(jar);
                if jar_path.is_absolute() {
                    return Ok(jar_path);
                } else {
                    return Ok(server_dir.join(&jar_path));
                }
            }
        }

        // Determine Paper version — default to 1.21.4.
        let version = manifest
            .server
            .as_ref()
            .and_then(|s| s.paper.clone())
            .unwrap_or_else(|| "1.21.4".to_string());

        // Check for a cached JAR matching the version.
        let cache_dir = home_dir().join(".quill").join("cache").join("paper");
        fs::create_dir_all(&cache_dir)
            .map_err(|e| QuillError::io_error("failed to create paper cache dir", e))?;

        // Look for any cached paper jar matching this version
        if let Ok(entries) = fs::read_dir(&cache_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with(&format!("paper-{}", version)) && name_str.ends_with(".jar") {
                    let cached = entry.path();
                    // Also copy/link into server_dir
                    let dest = server_dir.join(name_str.as_ref());
                    if !dest.exists() {
                        fs::copy(&cached, &dest)
                            .map_err(|e| QuillError::io_error("failed to copy cached paper jar", e))?;
                    }
                    return Ok(dest);
                }
            }
        }

        // Download: first get the latest build number.
        let builds_url = format!(
            "https://api.papermc.io/v2/projects/paper/versions/{}/builds",
            version
        );

        let client = reqwest::Client::new();
        let resp = client
            .get(&builds_url)
            .send()
            .await
            .map_err(|e| QuillError::DownloadFailed {
                url: builds_url.clone(),
                message: e.to_string(),
            })?;

        if !resp.status().is_success() {
            return Err(QuillError::DownloadFailed {
                url: builds_url,
                message: format!("HTTP {}", resp.status()),
            });
        }

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| QuillError::DownloadFailed {
                url: builds_url.clone(),
                message: format!("failed to parse builds JSON: {}", e),
            })?;

        let builds = body["builds"]
            .as_array()
            .ok_or_else(|| QuillError::DownloadFailed {
                url: builds_url.clone(),
                message: "no builds array in response".to_string(),
            })?;

        if builds.is_empty() {
            return Err(QuillError::DownloadFailed {
                url: builds_url,
                message: "no builds available".to_string(),
            });
        }

        // Take the last (latest) build.
        let latest = &builds[builds.len() - 1];
        let build_number = latest["build"]
            .as_i64()
            .ok_or_else(|| QuillError::DownloadFailed {
                url: format!(
                    "https://api.papermc.io/v2/projects/paper/versions/{}/builds",
                    version
                ),
                message: "build number missing from response".to_string(),
            })?;

        let jar_name = format!("paper-{}-{}.jar", version, build_number);
        let download_url = format!(
            "https://api.papermc.io/v2/projects/paper/versions/{}/builds/{}/downloads/{}",
            version, build_number, jar_name
        );

        println!("Downloading {}...", jar_name);

        let jar_resp = client
            .get(&download_url)
            .send()
            .await
            .map_err(|e| QuillError::DownloadFailed {
                url: download_url.clone(),
                message: e.to_string(),
            })?;

        if !jar_resp.status().is_success() {
            return Err(QuillError::DownloadFailed {
                url: download_url,
                message: format!("HTTP {}", jar_resp.status()),
            });
        }

        let bytes = jar_resp
            .bytes()
            .await
            .map_err(|e| QuillError::DownloadFailed {
                url: format!("paper-{}-{}", version, build_number),
                message: format!("failed to read response body: {}", e),
            })?;

        // Save to cache.
        let cached_path = cache_dir.join(&jar_name);
        fs::write(&cached_path, &bytes)
            .map_err(|e| QuillError::io_error("failed to write paper jar to cache", e))?;

        // Copy to server dir.
        let server_jar = server_dir.join(&jar_name);
        fs::copy(&cached_path, &server_jar)
            .map_err(|e| QuillError::io_error("failed to copy paper jar to server dir", e))?;

        Ok(server_jar)
    }

    /// Download (or locate cached) Ink plugin JAR into the server.
    async fn download_ink_jar(&self, server_dir: &Path) -> Result<PathBuf> {
        let ink_jar_path = server_dir.join("plugins").join("Ink.jar");

        if ink_jar_path.exists() {
            return Ok(ink_jar_path);
        }

        // Check for a local compiler JAR bundled with quill.
        let local_jar = home_dir()
            .join(".quill")
            .join("compiler")
            .join("ink.jar");

        if local_jar.exists() {
            fs::copy(&local_jar, &ink_jar_path)
                .map_err(|e| QuillError::io_error("failed to copy Ink plugin jar", e))?;
            return Ok(ink_jar_path);
        }

        // Download from the Ink GitHub releases.
        let download_url =
            "https://github.com/inklang/ink/releases/latest/download/Ink.jar".to_string();

        println!("Downloading Ink plugin...");

        let client = reqwest::Client::new();
        let resp = client
            .get(&download_url)
            .send()
            .await
            .map_err(|e| QuillError::DownloadFailed {
                url: download_url.clone(),
                message: e.to_string(),
            })?;

        if !resp.status().is_success() {
            return Err(QuillError::DownloadFailed {
                url: download_url,
                message: format!("HTTP {} — ensure Ink.jar is available", resp.status()),
            });
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| QuillError::DownloadFailed {
                url: "Ink.jar".to_string(),
                message: format!("failed to read response body: {}", e),
            })?;

        // Also cache in ~/.quill/compiler/
        if let Some(parent) = local_jar.parent() {
            let _ = fs::create_dir_all(parent);
            let _ = fs::write(&local_jar, &bytes);
        }

        fs::write(&ink_jar_path, &bytes)
            .map_err(|e| QuillError::io_error("failed to write Ink.jar", e))?;

        Ok(ink_jar_path)
    }

    /// Write `eula.txt` if it does not already exist.
    fn write_eula_if_absent(&self, server_dir: &Path) -> std::io::Result<()> {
        let eula_path = server_dir.join("eula.txt");
        if !eula_path.exists() {
            fs::write(&eula_path, "eula=true\n")?;
        }
        Ok(())
    }

    /// Write `server.properties` if it does not already exist, with sensible
    /// development defaults.
    fn write_props_if_absent(&self, server_dir: &Path) -> std::io::Result<()> {
        let props_path = server_dir.join("server.properties");
        if !props_path.exists() {
            let props = "\
# Quill managed dev server
allow-nether=false
level-name=world
motd=Quill Dev Server
online-mode=false
pvp=false
server-port=25565
spawn-npcs=false
white-list=false
";
            fs::write(&props_path, props)?;
        }
        Ok(())
    }

    /// Find the Paper JAR in the server directory.
    fn find_server_jar(&self, server_dir: &Path) -> Result<PathBuf> {
        let entries = fs::read_dir(server_dir)
            .map_err(|e| QuillError::io_error("failed to read server directory", e))?;

        for entry in entries {
            let entry = entry.map_err(|e| QuillError::io_error("failed to read directory entry", e))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("paper-") && name.ends_with(".jar") {
                return Ok(entry.path());
            }
        }

        Err(QuillError::ServerSpawnFailed {
            message: "no Paper JAR found in server directory".to_string(),
        })
    }

    /// Build the project, deploy outputs, and return the server JAR path.
    async fn build_and_deploy(&self, ctx: &Context, server_dir: &Path) -> Result<PathBuf> {
        let _manifest = ctx.manifest.as_ref().ok_or_else(|| {
            QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-package.toml"),
            }
        })?;

        // Build
        let output_dir = ctx.project_dir.join("target").join("ink");
        let build = crate::commands::build::Build {
            output: Some(output_dir.clone()),
            target: None,
        };
        build.execute(ctx).await?;

        // Deploy
        deploy_scripts(server_dir, &output_dir)
            .map_err(|e| QuillError::io_error("failed to deploy scripts", e))?;
        deploy_grammar_jars(server_dir, &output_dir)
            .map_err(|e| QuillError::io_error("failed to deploy grammar jars", e))?;

        // Find server JAR
        self.find_server_jar(server_dir)
    }

    /// Spawn the Paper server process.
    fn spawn_server(&self, server_jar: &Path, server_dir: &Path) -> Result<Child> {
        let child = TokioCommand::new("java")
            .arg("-jar")
            .arg(server_jar)
            .arg("nogui")
            .current_dir(server_dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| QuillError::ServerSpawnFailed {
                message: format!("failed to spawn server: {}", e),
            })?;

        Ok(child)
    }

    /// Kill a running server process gracefully (then forcefully).
    async fn kill_server(&self, child: &mut Option<Child>) {
        if let Some(ref mut proc) = child {
            // Try graceful shutdown via stdin "stop" command
            if let Some(ref mut stdin) = proc.stdin {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(b"stop\n").await;
                let _ = stdin.flush().await;
            }
            // Wait a moment, then kill if still running
            match tokio::time::timeout(Duration::from_secs(10), proc.wait()).await {
                Ok(_) => {}
                Err(_) => {
                    let _ = proc.kill().await;
                }
            }
        }
        *child = None;
    }
}

#[async_trait]
impl Command for Run {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-package.toml"),
            }
        })?;

        // 1. Check Java
        self.check_java().await?;
        println!("Java found.");

        // 2. Resolve server directory
        let server_dir = resolve_server_dir(&ctx.project_dir, manifest);
        ensure_server_dir(&server_dir)
            .map_err(|e| QuillError::io_error("failed to create server directory", e))?;
        println!("Server directory: {}", server_dir.display());

        // 3. Download / resolve Paper JAR
        let server_jar = self.resolve_paper_jar(manifest, &server_dir).await?;
        println!("Paper JAR: {}", server_jar.display());

        // 4. Download Ink plugin
        let _ink_jar = self.download_ink_jar(&server_dir).await?;
        println!("Ink plugin ready.");

        // 5. Write eula.txt and server.properties
        self.write_eula_if_absent(&server_dir)
            .map_err(|e| QuillError::io_error("failed to write eula.txt", e))?;
        self.write_props_if_absent(&server_dir)
            .map_err(|e| QuillError::io_error("failed to write server.properties", e))?;

        // 6. Build and deploy
        let server_jar = self.build_and_deploy(ctx, &server_dir).await?;

        // 7. Spawn server
        println!("Starting server...");
        let mut server_child = Some(self.spawn_server(&server_jar, &server_dir)?);

        if self.no_watch {
            // Just wait for the server to exit.
            if let Some(ref mut child) = server_child {
                let status = child.wait().await.map_err(|e| QuillError::ServerSpawnFailed {
                    message: format!("server process error: {}", e),
                })?;
                println!("Server exited with status: {}", status);
            }
            return Ok(());
        }

        // 8. Watch mode
        println!("Watching for changes... (Ctrl-C to stop)");

        // Set up file watcher
        let (watch_tx, watch_rx) = mpsc::channel::<notify::Result<NotifyEvent>>();
        let mut watcher = recommended_watcher(watch_tx).map_err(|e| QuillError::ServerSpawnFailed {
            message: format!("failed to create file watcher: {}", e),
        })?;

        // Watch relevant directories
        let watch_dirs = ["src", "scripts", "runtime/src"];
        for dir_name in &watch_dirs {
            let watch_path = ctx.project_dir.join(dir_name);
            if watch_path.exists() {
                watcher
                    .watch(&watch_path, RecursiveMode::Recursive)
                    .map_err(|e| QuillError::ServerSpawnFailed {
                        message: format!("failed to watch {}: {}", dir_name, e),
                    })?;
            }
        }

        // We need to keep `watcher` alive for the duration — drop it at the end.
        let _watcher = watcher;

        // Backoff state for server crashes
        let mut backoff_secs: u64 = 2;

        // Use a tokio channel to bridge the std::sync::mpsc receiver into async land
        let (async_watch_tx, mut async_watch_rx) = tokio::sync::mpsc::channel::<()>(32);

        // Spawn a task that forwards watch events
        let watch_forward = tokio::spawn(async move {
            // Drain the std::sync channel and send notifications
            loop {
                match watch_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(_) => {
                        let _ = async_watch_tx.send(()).await;
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        // Ctrl-C handler
        let (ctrl_c_tx, mut ctrl_c_rx) = tokio::sync::mpsc::channel::<()>(1);
        let _ctrl_c = tokio::spawn(async move {
            tokio::signal::ctrl_c().await.ok();
            let _ = ctrl_c_tx.send(()).await;
        });

        loop {
            tokio::select! {
                // File change detected
                Some(()) = async_watch_rx.recv() => {
                    // Debounce: drain any additional events that arrived quickly
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    while async_watch_rx.try_recv().is_ok() {}

                    println!("\nChange detected — rebuilding...");
                    self.kill_server(&mut server_child).await;

                    match self.build_and_deploy(ctx, &server_dir).await {
                        Ok(jar) => {
                            println!("Rebuild successful — restarting server...");
                            backoff_secs = 2;
                            match self.spawn_server(&jar, &server_dir) {
                                Ok(child) => server_child = Some(child),
                                Err(e) => eprintln!("Failed to restart server: {}", e),
                            }
                        }
                        Err(e) => {
                            eprintln!("Rebuild failed: {}", e);
                        }
                    }
                }

                // Server process exited
                status = async {
                    if let Some(ref mut child) = server_child {
                        child.wait().await
                    } else {
                        // No server running; sleep indefinitely so this branch
                        // never resolves until something else wakes us.
                        std::future::pending().await
                    }
                } => {
                    match status {
                        Ok(status) => {
                            if status.success() {
                                println!("Server shut down cleanly.");
                                break;
                            } else {
                                eprintln!("Server crashed (exit: {}). Restarting in {}s...", status, backoff_secs);
                                tokio::time::sleep(Duration::from_secs(backoff_secs)).await;

                                let server_jar = self.find_server_jar(&server_dir)?;
                                match self.spawn_server(&server_jar, &server_dir) {
                                    Ok(child) => {
                                        server_child = Some(child);
                                        backoff_secs = (backoff_secs * 2).min(30);
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to restart server: {}", e);
                                        break;
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Failed to wait on server: {}", e);
                            break;
                        }
                    }
                }

                // Ctrl-C
                _ = ctrl_c_rx.recv() => {
                    println!("\nShutting down...");
                    self.kill_server(&mut server_child).await;
                    break;
                }
            }
        }

        watch_forward.abort();
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tempfile::TempDir;

    fn make_manifest(
        name: &str,
        server_paper: Option<&str>,
        server_jar: Option<&str>,
        server_path: Option<&str>,
    ) -> PackageManifest {
        PackageManifest {
            package: crate::manifest::toml::PackageInfo {
                name: name.to_string(),
                version: "0.1.0".to_string(),
                package_type: None,
                description: None,
                author: None,
                homepage: None,
                repository: None,
                main: None,
                target: None,
            },
            dependencies: BTreeMap::new(),
            grammar: None,
            build: None,
            runtime: None,
            server: Some(crate::manifest::toml::ServerConfig {
                paper: server_paper.map(|s| s.to_string()),
                jar: server_jar.map(|s| s.to_string()),
                path: server_path.map(|s| s.to_string()),
            }),
            targets: BTreeMap::new(),
        }
    }

    fn make_manifest_no_server(name: &str) -> PackageManifest {
        PackageManifest {
            package: crate::manifest::toml::PackageInfo {
                name: name.to_string(),
                version: "0.1.0".to_string(),
                package_type: None,
                description: None,
                author: None,
                homepage: None,
                repository: None,
                main: None,
                target: None,
            },
            dependencies: BTreeMap::new(),
            grammar: None,
            build: None,
            runtime: None,
            server: None,
            targets: BTreeMap::new(),
        }
    }

    // ---- resolve_server_dir ----

    #[test]
    fn resolve_server_dir_absolute_path() {
        let tmp = TempDir::new().unwrap();
        let abs_path = if cfg!(windows) {
            "C:\\opt\\mc-server"
        } else {
            "/opt/mc-server"
        };
        let manifest = make_manifest("my-plugin", None, None, Some(abs_path));
        let result = resolve_server_dir(tmp.path(), &manifest);
        assert_eq!(result, PathBuf::from(abs_path));
    }

    #[test]
    fn resolve_server_dir_relative_path() {
        let tmp = TempDir::new().unwrap();
        let manifest = make_manifest("my-plugin", None, None, Some("run/server"));
        let result = resolve_server_dir(tmp.path(), &manifest);
        assert_eq!(result, tmp.path().join("run").join("server"));
    }

    #[test]
    fn resolve_server_dir_default_uses_home() {
        let tmp = TempDir::new().unwrap();
        let manifest = make_manifest_no_server("my-plugin");
        let result = resolve_server_dir(tmp.path(), &manifest);
        let expected = home_dir()
            .join(".quill")
            .join("server")
            .join("my-plugin");
        assert_eq!(result, expected);
    }

    #[test]
    fn resolve_server_dir_server_present_but_no_path() {
        let tmp = TempDir::new().unwrap();
        let manifest = make_manifest("my-plugin", Some("1.21.4"), None, None);
        let result = resolve_server_dir(tmp.path(), &manifest);
        let expected = home_dir()
            .join(".quill")
            .join("server")
            .join("my-plugin");
        assert_eq!(result, expected);
    }

    // ---- ensure_server_dir ----

    #[test]
    fn ensure_server_dir_creates_structure() {
        let tmp = TempDir::new().unwrap();
        let server_dir = tmp.path().join("server");

        ensure_server_dir(&server_dir).unwrap();

        assert!(server_dir.join("plugins").is_dir());
        assert!(server_dir.join("plugins/Ink").is_dir());
        assert!(server_dir.join("plugins/Ink/plugins").is_dir());
        assert!(server_dir.join("plugins/Ink/scripts").is_dir());
    }

    #[test]
    fn ensure_server_dir_idempotent() {
        let tmp = TempDir::new().unwrap();
        let server_dir = tmp.path().join("server");

        ensure_server_dir(&server_dir).unwrap();
        ensure_server_dir(&server_dir).unwrap(); // should not fail

        assert!(server_dir.join("plugins/Ink/scripts").is_dir());
    }

    // ---- deploy_scripts ----

    #[test]
    fn deploy_scripts_copies_inkc_files() {
        let tmp = TempDir::new().unwrap();
        let server_dir = tmp.path().join("server");
        let output_dir = tmp.path().join("output");

        // Create fake compiled files
        fs::create_dir_all(output_dir.join("sub")).unwrap();
        fs::write(output_dir.join("main.inkc"), b"compiled-main").unwrap();
        fs::write(output_dir.join("sub").join("helper.inkc"), b"compiled-helper").unwrap();
        fs::write(output_dir.join("ignored.txt"), b"not-inkc").unwrap();

        // Create server scripts dir
        ensure_server_dir(&server_dir).unwrap();

        deploy_scripts(&server_dir, &output_dir).unwrap();

        let scripts_dir = server_dir.join("plugins/Ink/scripts");
        assert!(scripts_dir.join("main.inkc").exists());
        assert!(scripts_dir.join("sub/helper.inkc").exists());
        assert!(!scripts_dir.join("ignored.txt").exists());

        // Verify content
        assert_eq!(
            fs::read_to_string(scripts_dir.join("main.inkc")).unwrap(),
            "compiled-main"
        );
    }

    #[test]
    fn deploy_scripts_empty_output_dir() {
        let tmp = TempDir::new().unwrap();
        let server_dir = tmp.path().join("server");
        let output_dir = tmp.path().join("output");

        // output_dir does not exist
        ensure_server_dir(&server_dir).unwrap();
        deploy_scripts(&server_dir, &output_dir).unwrap(); // should not fail
    }

    // ---- deploy_grammar_jars ----

    #[test]
    fn deploy_grammar_jars_copies_jars() {
        let tmp = TempDir::new().unwrap();
        let server_dir = tmp.path().join("server");
        let output_dir = tmp.path().join("output");

        // Create fake grammar JARs
        fs::create_dir_all(output_dir.join("grammars")).unwrap();
        fs::write(output_dir.join("grammars").join("mobs.jar"), b"jar-content").unwrap();
        fs::write(output_dir.join("ignored.txt"), b"not-jar").unwrap();

        ensure_server_dir(&server_dir).unwrap();

        deploy_grammar_jars(&server_dir, &output_dir).unwrap();

        let plugins_dir = server_dir.join("plugins/Ink/plugins");
        assert!(plugins_dir.join("mobs.jar").exists());
        assert!(!plugins_dir.join("ignored.txt").exists());

        // Verify content
        assert_eq!(
            fs::read_to_string(plugins_dir.join("mobs.jar")).unwrap(),
            "jar-content"
        );
    }

    #[test]
    fn deploy_grammar_jars_empty_output_dir() {
        let tmp = TempDir::new().unwrap();
        let server_dir = tmp.path().join("server");
        let output_dir = tmp.path().join("nonexistent");

        ensure_server_dir(&server_dir).unwrap();
        deploy_grammar_jars(&server_dir, &output_dir).unwrap(); // should not fail
    }

    // ---- write_eula_if_absent / write_props_if_absent ----

    #[test]
    fn write_eula_creates_file() {
        let tmp = TempDir::new().unwrap();
        let run = Run { no_watch: true };

        run.write_eula_if_absent(tmp.path()).unwrap();
        let content = fs::read_to_string(tmp.path().join("eula.txt")).unwrap();
        assert!(content.contains("eula=true"));
    }

    #[test]
    fn write_eula_does_not_overwrite() {
        let tmp = TempDir::new().unwrap();
        let run = Run { no_watch: true };

        fs::write(tmp.path().join("eula.txt"), "eula=false\n").unwrap();
        run.write_eula_if_absent(tmp.path()).unwrap();
        let content = fs::read_to_string(tmp.path().join("eula.txt")).unwrap();
        assert!(content.contains("eula=false"));
    }

    #[test]
    fn write_props_creates_file() {
        let tmp = TempDir::new().unwrap();
        let run = Run { no_watch: true };

        run.write_props_if_absent(tmp.path()).unwrap();
        let content = fs::read_to_string(tmp.path().join("server.properties")).unwrap();
        assert!(content.contains("online-mode=false"));
    }

    #[test]
    fn write_props_does_not_overwrite() {
        let tmp = TempDir::new().unwrap();
        let run = Run { no_watch: true };

        fs::write(tmp.path().join("server.properties"), "server-port=12345\n").unwrap();
        run.write_props_if_absent(tmp.path()).unwrap();
        let content = fs::read_to_string(tmp.path().join("server.properties")).unwrap();
        assert!(content.contains("server-port=12345"));
    }
}
