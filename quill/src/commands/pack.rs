use async_trait::async_trait;
use std::path::PathBuf;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::util::fs;

pub struct Pack {
    pub allow_dirty: bool,
}

#[async_trait]
impl Command for Pack {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-manifest.toml"),
            }
        })?;

        // Check for uncommitted changes if not allowed
        if !self.allow_dirty {
            // In a full implementation, we would check git status here
            // For now, we just proceed
        }

        // Create tarball of project
        let tarball_name = format!("{}-{}.tar.gz",
            manifest.package.name,
            manifest.package.version
        );
        let tarball_path = ctx.project_dir.join(&tarball_name);

        fs::create_tarball(&ctx.project_dir, &tarball_path)?;

        println!("Created tarball: {}", tarball_path.display());
        Ok(())
    }
}
