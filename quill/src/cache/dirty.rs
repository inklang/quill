use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use crate::error::{QuillError, Result};
use sha2::{Digest, Sha256};

use super::CacheManifest;

/// Find files that need to be recompiled.
///
/// If `full` is true, returns all .ink files in the project.
/// If `full` is false, compares file hashes against cache entries.
pub fn find_dirty_files(project_dir: &Path, cache: &CacheManifest, full: bool) -> Vec<PathBuf> {
    let mut dirty = Vec::new();

    if full {
        // Full rebuild: find all .ink files
        find_ink_files(project_dir, &mut dirty);
        return dirty;
    }

    // Incremental: compare hashes
    find_dirty_incremental(project_dir, cache, &mut dirty);
    dirty
}

fn find_ink_files(dir: &Path, results: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Skip hidden directories and common non-source directories
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') || name == "target" || name == "node_modules" {
                    continue;
                }
            }
            find_ink_files(&path, results);
        } else if path.extension().and_then(|e| e.to_str()) == Some("ink") {
            results.push(path);
        }
    }
}

fn find_dirty_incremental(project_dir: &Path, cache: &CacheManifest, results: &mut Vec<PathBuf>) {
    let mut ink_files = Vec::new();
    find_ink_files(project_dir, &mut ink_files);

    for file in ink_files {
        let Ok(hash) = hash_file(&file) else {
            // If we can't hash the file, consider it dirty
            results.push(file);
            continue;
        };

        // Get the relative path as the cache key
        let key = file
            .strip_prefix(project_dir)
            .unwrap_or(&file)
            .to_string_lossy()
            .replace('\\', "/");

        if let Some(entry) = cache.entries.get(&key) {
            if entry.hash != hash {
                results.push(file);
            }
        } else {
            // New file, not in cache
            results.push(file);
        }
    }
}

/// Compute the SHA-256 hash of a file.
pub fn hash_file(path: &Path) -> Result<String> {
    let file = fs::File::open(path).map_err(|e| QuillError::io_error(
        format!("failed to open {}", path.display()),
        e,
    ))?;

    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = reader.read(&mut buffer).map_err(|e| QuillError::io_error(
            format!("failed to read {}", path.display()),
            e,
        ))?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::io::Write;
    use tempfile::TempDir;
    use crate::cache::{CacheEntry, CacheManifest};

    #[test]
    fn test_hash_file() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.ink");
        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all(b"hello world").unwrap();
        drop(file);

        let hash = hash_file(&file_path).unwrap();
        // SHA-256 of "hello world"
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn test_find_dirty_files_full() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        // Create some .ink files
        fs::write(dir.join("test1.ink"), "rule a = keyword \"a\";").unwrap();
        fs::write(dir.join("test2.ink"), "rule b = keyword \"b\";").unwrap();

        let manifest = CacheManifest::default();
        let dirty = find_dirty_files(dir, &manifest, true);

        assert_eq!(dirty.len(), 2);
    }

    #[test]
    fn test_find_dirty_files_incremental() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();

        let file_path = dir.join("test.ink");
        fs::write(&file_path, "rule a = keyword \"a\";").unwrap();

        let hash = hash_file(&file_path).unwrap();

        // Create a manifest with this file's hash
        let mut entries = BTreeMap::new();
        entries.insert(
            "test.ink".to_string(),
            CacheEntry {
                hash: hash.clone(),
                output: "test.inkc".to_string(),
                compiled_at: "12345".to_string(),
            },
        );

        let manifest = CacheManifest {
            version: 1,
            last_full_build: "12345".to_string(),
            grammar_ir_hash: None,
            runtime_jar_hash: None,
            entries,
        };

        // File hasn't changed, should not be dirty
        let dirty = find_dirty_files(dir, &manifest, false);
        assert!(dirty.is_empty());

        // Modify the file
        fs::write(&file_path, "rule b = keyword \"b\";").unwrap();
        let dirty = find_dirty_files(dir, &manifest, false);
        assert_eq!(dirty.len(), 1);
    }
}
