use std::path::Path;
use sha2::{Sha256, Digest};
use crate::error::{QuillError, Result};

pub fn verify_checksum(file: &Path, expected: &str) -> Result<()> {
    let content = std::fs::read(file)
        .map_err(|e| QuillError::io_error("failed to read file for checksum", e))?;

    let mut hasher = Sha256::new();
    hasher.update(&content);
    let result = hasher.finalize();

    let actual = hex::encode(result);

    if actual != expected {
        return Err(QuillError::ChecksumMismatch {
            package: file.display().to_string(),
            expected: expected.to_string(),
            actual,
        });
    }

    Ok(())
}
