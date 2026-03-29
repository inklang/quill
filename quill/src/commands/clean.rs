use async_trait::async_trait;
use std::fs;
use std::path::Path;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};

pub struct Clean;

#[async_trait]
impl Command for Clean {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let target_dir = ctx.project_dir.join("target");

        if !target_dir.exists() {
            println!("Nothing to clean (target directory does not exist)");
            return Ok(());
        }

        // Remove .inkc files and ink-manifest.json
        remove_build_artifacts(&target_dir)?;

        println!("Cleaned build artifacts in {}", target_dir.display());
        Ok(())
    }
}

fn remove_build_artifacts(dir: &Path) -> Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)
            .map_err(|e| QuillError::io_error(&format!("failed to read dir {}", dir.display()), e))?
        {
            let entry = entry
                .map_err(|e| QuillError::io_error("failed to read dir entry", e))?;
            let path = entry.path();

            if path.is_dir() {
                remove_build_artifacts(&path)?;
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ext == "inkc" {
                    fs::remove_file(&path)
                        .map_err(|e| QuillError::io_error(&format!("failed to remove {}", path.display()), e))?;
                    println!("  Removed: {}", path.display());
                }
            }

            // Remove ink-manifest.json files
            if path.file_name().and_then(|n| n.to_str()) == Some("ink-manifest.json") {
                fs::remove_file(&path)
                    .map_err(|e| QuillError::io_error(&format!("failed to remove {}", path.display()), e))?;
                println!("  Removed: {}", path.display());
            }
        }
    }
    Ok(())
}
