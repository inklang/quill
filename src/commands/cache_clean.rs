use async_trait::async_trait;
use std::fs;
use std::path::PathBuf;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};

pub struct CacheClean;

#[async_trait]
impl Command for CacheClean {
    async fn execute(&self, _ctx: &Context) -> Result<()> {
        let cache_dir = get_cache_dir()?;

        if !cache_dir.exists() {
            println!("Cache directory does not exist: {}", cache_dir.display());
            return Ok(());
        }

        // Remove all contents of the cache directory
        for entry in fs::read_dir(&cache_dir)
            .map_err(|e| QuillError::io_error("failed to read cache directory", e))?
        {
            let entry = entry
                .map_err(|e| QuillError::io_error("failed to read cache entry", e))?;
            let path = entry.path();

            if path.is_dir() {
                fs::remove_dir_all(&path)
                    .map_err(|e| QuillError::io_error(&format!("failed to remove {}", path.display()), e))?;
            } else {
                fs::remove_file(&path)
                    .map_err(|e| QuillError::io_error(&format!("failed to remove {}", path.display()), e))?;
            }
        }

        println!("Cache cleaned: {}", cache_dir.display());
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
