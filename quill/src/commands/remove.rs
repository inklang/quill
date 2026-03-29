use async_trait::async_trait;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;

pub struct Remove {
    pub packages: Vec<String>,
}

#[async_trait]
impl Command for Remove {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            crate::error::QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-manifest.toml"),
            }
        })?;

        let mut updated_deps = manifest.dependencies.clone();
        for pkg in &self.packages {
            if updated_deps.remove(pkg).is_some() {
                println!("Removed dependency: {}", pkg);
            } else {
                println!("Dependency not found in manifest: {}", pkg);
            }
        }

        let mut updated_manifest = manifest.clone();
        updated_manifest.dependencies = updated_deps;

        let manifest_path = ctx.project_dir.join("ink-manifest.toml");
        let content = toml::to_string_pretty(&updated_manifest)
            .map_err(|e| crate::error::QuillError::RegistryAuth {
                message: format!("failed to serialize manifest: {}", e),
            })?;
        std::fs::write(&manifest_path, content)
            .map_err(|e| crate::error::QuillError::io_error("failed to write manifest", e))?;

        Ok(())
    }
}
