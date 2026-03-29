use async_trait::async_trait;
use std::fs;
use std::path::PathBuf;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};

pub struct CacheInfo;

#[async_trait]
impl Command for CacheInfo {
    async fn execute(&self, _ctx: &Context) -> Result<()> {
        let cache_dir = get_cache_dir()?;

        if !cache_dir.exists() {
            println!("Cache directory does not exist: {}", cache_dir.display());
            println!("Run 'quill install' to populate the cache");
            return Ok(());
        }

        // Calculate cache size
        let (total_size, file_count) = calculate_dir_size(&cache_dir)?;

        println!("Cache location: {}", cache_dir.display());
        println!("Total size: {}", format_size(total_size));
        println!("Files: {}", file_count);

        // List cache contents
        let packages_dir = cache_dir.join("packages");
        if packages_dir.exists() {
            let entries = fs::read_dir(&packages_dir)
                .map_err(|e| QuillError::io_error("failed to read packages directory", e))?;

            let mut package_count = 0;
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    package_count += 1;
                }
            }
            println!("Cached packages: {}", package_count);
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

fn calculate_dir_size(path: &PathBuf) -> Result<(u64, usize)> {
    let mut total_size = 0u64;
    let mut file_count = 0usize;

    if path.is_dir() {
        for entry in fs::read_dir(path)
            .map_err(|e| QuillError::io_error(&format!("failed to read dir {}", path.display()), e))?
        {
            let entry = entry
                .map_err(|e| QuillError::io_error("failed to read dir entry", e))?;
            let path = entry.path();

            if path.is_dir() {
                let (sub_size, sub_count) = calculate_dir_size(&path)?;
                total_size += sub_size;
                file_count += sub_count;
            } else {
                let metadata = fs::metadata(&path)
                    .map_err(|e| QuillError::io_error(&format!("failed to get metadata for {}", path.display()), e))?;
                total_size += metadata.len();
                file_count += 1;
            }
        }
    }

    Ok((total_size, file_count))
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}
