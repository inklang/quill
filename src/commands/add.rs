use async_trait::async_trait;
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;
use crate::manifest::PackageManifest;
use crate::registry::RegistryClient;
use crate::resolve;

pub struct Add {
    pub version: Option<String>,
    pub registry: Option<String>,
    pub packages: Vec<String>,
}

#[async_trait]
impl Command for Add {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            crate::error::QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-manifest.toml"),
            }
        })?;

        let registry_url = self.registry.as_ref().unwrap_or(&ctx.registry_url);
        let client = RegistryClient::new(registry_url);

        // Fetch registry index
        let index = client.fetch_index().await?;

        // Build root constraints from command line packages
        let mut roots: BTreeMap<String, String> = BTreeMap::new();
        for pkg in &self.packages {
            // Parse package name and optional version
            let (name, version) = if let Some((n, v)) = pkg.split_once('@') {
                (n.to_string(), v.to_string())
            } else {
                (pkg.clone(), self.version.clone().unwrap_or_else(|| "^0.1.0".to_string()))
            };
            roots.insert(name, version);
        }

        // Resolve transitive dependencies
        let resolved = resolve::resolve_transitive(&index, &roots)?;

        // Update manifest dependencies
        let mut updated_deps = manifest.dependencies.clone();
        for (name, resolved_pkg) in resolved {
            // Only add direct dependencies (those specified on command line)
            if self.packages.iter().any(|p| p.starts_with(&name) || p == &name) {
                updated_deps.insert(name, format!("^{}", resolved_pkg.version));
            }
        }

        // Create updated manifest
        let mut updated_manifest = manifest.clone();
        updated_manifest.dependencies = updated_deps;

        // Save manifest
        let manifest_path = ctx.project_dir.join("ink-manifest.toml");
        let content = toml::to_string_pretty(&updated_manifest)
            .map_err(|e| crate::error::QuillError::RegistryAuth {
                message: format!("failed to serialize manifest: {}", e),
            })?;
        std::fs::write(&manifest_path, content)
            .map_err(|e| crate::error::QuillError::io_error("failed to write manifest", e))?;

        println!("Added dependencies to manifest");
        Ok(())
    }
}
