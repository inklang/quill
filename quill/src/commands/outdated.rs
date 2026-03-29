use async_trait::async_trait;
use std::collections::BTreeMap;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;
use crate::registry::RegistryClient;

pub struct Outdated {
    pub precision: Option<String>,
    pub hide: Vec<String>,
}

#[async_trait]
impl Command for Outdated {
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

        // Check each dependency
        let mut outdated = Vec::new();

        for (name, current_range) in &manifest.dependencies {
            // Skip if hidden
            if self.hide.iter().any(|h| h == name) {
                continue;
            }

            // Get installed version from lockfile
            let installed_version = lockfile.packages.get(name)
                .map(|p| p.version.as_str())
                .unwrap_or("unknown");

            // Find latest version in registry
            if let Some((latest_version, _pkg)) = index.find_best_match(name, current_range) {
                if installed_version != latest_version {
                    outdated.push((name.clone(), installed_version.to_string(), latest_version.to_string()));
                }
            }
        }

        if outdated.is_empty() {
            println!("All dependencies are up to date");
        } else {
            println!("Outdated dependencies:");
            println!("{:<30} {:<15} {:<15}", "Package", "Current", "Latest");
            println!("{}", "-".repeat(60));
            for (name, current, latest) in &outdated {
                println!("{:<30} {:<15} {:<15}", name, current, latest);
            }
        }

        Ok(())
    }
}
