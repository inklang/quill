use async_trait::async_trait;
use std::collections::BTreeMap;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;
use crate::manifest::Lockfile;
use crate::registry::RegistryClient;
use crate::resolve;

pub struct Update {
    pub precision: Option<String>,
    pub recursive: bool,
    pub packages: Vec<String>,
}

#[async_trait]
impl Command for Update {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            crate::error::QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-manifest.toml"),
            }
        })?;

        let lockfile = ctx.lockfile.as_ref().ok_or_else(|| {
            crate::error::QuillError::io_error(
                "lockfile not found",
                std::io::Error::new(std::io::ErrorKind::NotFound, "lockfile not found")
            )
        })?;

        let registry_url = &ctx.registry_url;
        let client = RegistryClient::new(registry_url);

        // Fetch latest registry index
        let index = client.fetch_index().await?;

        // Determine which packages to update
        let packages_to_update: Vec<String> = if self.packages.is_empty() {
            // Update all dependencies
            manifest.dependencies.keys().cloned().collect()
        } else {
            self.packages.clone()
        };

        // Build updated dependencies map with new version ranges
        let mut updated_deps: BTreeMap<String, String> = manifest.dependencies.clone();

        for pkg_name in &packages_to_update {
            if let Some(current_range) = manifest.dependencies.get(pkg_name) {
                // Find latest version matching the current range precision
                if let Some((version_str, _pkg)) = index.find_best_match(pkg_name, current_range) {
                    updated_deps.insert(pkg_name.clone(), format!("^{}", version_str));
                    println!("Updated {}: {} -> ^{}", pkg_name, current_range, version_str);
                }
            }
        }

        // Re-resolve with updated dependencies
        let resolved = resolve::resolve_transitive(&index, &updated_deps)?;

        // Update lockfile
        let mut packages: BTreeMap<String, crate::manifest::LockedPackage> = BTreeMap::new();
        for (name, resolved_pkg) in &resolved {
            packages.insert(
                name.clone(),
                crate::manifest::LockedPackage {
                    version: resolved_pkg.version.clone(),
                    resolution_source: registry_url.clone(),
                    dependencies: resolved_pkg.dep_keys.clone(),
                },
            );
        }

        let updated_lockfile = Lockfile {
            version: lockfile.version,
            registry: registry_url.clone(),
            packages,
        };

        // Save updated lockfile
        let lockfile_path = ctx.project_dir.join("quill.lock");
        updated_lockfile.save(&lockfile_path)?;

        // Save updated manifest
        let mut updated_manifest = manifest.clone();
        updated_manifest.dependencies = updated_deps;

        let manifest_path = ctx.project_dir.join("ink-manifest.toml");
        let content = toml::to_string_pretty(&updated_manifest)
            .map_err(|e| crate::error::QuillError::RegistryAuth {
                message: format!("failed to serialize manifest: {}", e),
            })?;
        std::fs::write(&manifest_path, content)
            .map_err(|e| crate::error::QuillError::io_error("failed to write manifest", e))?;

        println!("Updated dependencies");
        Ok(())
    }
}
