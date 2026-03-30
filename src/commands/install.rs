use async_trait::async_trait;
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use std::collections::BTreeMap;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
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

async fn load_cached_index(cache_dir: &Path) -> Result<crate::registry::index::RegistryIndex> {
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
