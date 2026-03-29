use async_trait::async_trait;
use std::collections::BTreeMap;
use std::path::PathBuf;

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
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-manifest.toml"),
            }
        })?;

        let registry_url = &ctx.registry_url;
        let client = RegistryClient::new(registry_url);

        // Get cache directory
        let cache_dir = get_cache_dir()?;
        let cache_manifest_path = cache_dir.join("manifest.json");

        // Load or create cache manifest
        let cache_manifest = if cache_manifest_path.exists() {
            let content = std::fs::read_to_string(&cache_manifest_path)
                .map_err(|e| QuillError::io_error("failed to read cache manifest", e))?;
            serde_json::from_str(&content)
                .map_err(|e| QuillError::RegistryAuth {
                    message: format!("failed to parse cache manifest: {}", e),
                })?
        } else {
            CacheManifest::default()
        };

        // Fetch registry index
        let index = if self.offline {
            // Try to use cached index
            if let Ok(index) = load_cached_index(&cache_dir).await {
                index
            } else {
                return Err(QuillError::RegistryAuth {
                    message: "offline mode requires cached index".to_string(),
                });
            }
        } else {
            client.fetch_index().await?
        };

        // Resolve transitive dependencies
        let resolved = resolve::resolve_transitive(&index, &manifest.dependencies)?;

        // Create lockfile
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

        let lockfile = Lockfile {
            version: 1,
            registry: registry_url.clone(),
            packages,
        };

        // Save lockfile
        let lockfile_path = ctx.project_dir.join("quill.lock");
        lockfile.save(&lockfile_path)?;

        // Download and extract each package
        for (name, resolved_pkg) in &resolved {
            let package_cache_dir = cache_dir.join("packages").join(name);
            let tarball_path = package_cache_dir.join("package.tar.gz");

            // Check if already cached
            if !tarball_path.exists() {
                if self.offline {
                    return Err(QuillError::RegistryAuth {
                        message: format!("offline: {} not in cache", name),
                    });
                }

                // Download package
                std::fs::create_dir_all(&package_cache_dir)
                    .map_err(|e| QuillError::io_error("failed to create cache directory", e))?;
                client.download_package(&resolved_pkg.url, &tarball_path).await?;
            }

            // Extract to project or cache
            let extract_dir = ctx.project_dir.join("node_modules").join(name);
            std::fs::create_dir_all(extract_dir.parent().unwrap_or(&extract_dir))
                .map_err(|e| QuillError::io_error("failed to create directory", e))?;
            quill_fs::extract_tarball(&tarball_path, &extract_dir)?;
        }

        // Update cache manifest
        let cache_manifest_json = serde_json::to_string_pretty(&cache_manifest)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to serialize cache manifest: {}", e),
            })?;
        std::fs::write(&cache_manifest_path, cache_manifest_json)
            .map_err(|e| QuillError::io_error("failed to write cache manifest", e))?;

        println!("Installed {} dependencies", resolved.len());
        Ok(())
    }
}

fn get_cache_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME")
        .map_err(|_| QuillError::RegistryAuth {
            message: "HOME environment variable not set".to_string(),
        })?;
    Ok(PathBuf::from(home).join(".quill").join("cache"))
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
    decoder.read_to_end(&mut decompressed)
        .map_err(|e| QuillError::RegistryAuth {
            message: format!("failed to decompress cached index: {}", e),
        })?;

    serde_json::from_slice(&decompressed)
        .map_err(|e| QuillError::RegistryAuth {
            message: format!("failed to parse cached index: {}", e),
        })
}
