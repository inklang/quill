use async_trait::async_trait;
use std::fs;
use std::path::PathBuf;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};

pub struct CacheLs;

#[async_trait]
impl Command for CacheLs {
    async fn execute(&self, _ctx: &Context) -> Result<()> {
        let cache_dir = get_cache_dir()?;
        let packages_dir = cache_dir.join("packages");

        if !packages_dir.exists() {
            println!("No cached packages");
            return Ok(());
        }

        let entries = fs::read_dir(&packages_dir)
            .map_err(|e| QuillError::io_error("failed to read packages directory", e))?;

        let mut packages = Vec::new();
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                packages.push(name);
            }
        }

        if packages.is_empty() {
            println!("No cached packages");
        } else {
            println!("Cached packages:");
            for name in &packages {
                println!("  {}", name);
            }
            println!("\n{} packages cached", packages.len());
        }

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
