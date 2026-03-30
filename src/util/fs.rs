use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use tar::Archive;

use crate::error::{QuillError, Result};

/// Download a file from a URL and save it to the destination path.
pub fn download_file(url: &str, dest: &Path) -> Result<()> {
    let response = reqwest::blocking::get(url)
        .map_err(|e| QuillError::RegistryRequest {
            url: url.to_string(),
            source: e,
        })?;

    if !response.status().is_success() {
        return Err(QuillError::RegistryRequest {
            url: url.to_string(),
            source: reqwest::Error::from(response.error_for_status().err().unwrap()),
        });
    }

    let bytes = response
        .bytes()
        .map_err(|e| QuillError::RegistryRequest {
            url: url.to_string(),
            source: e,
        })?;

    // Create parent directories if needed
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| QuillError::io_error("failed to create parent directory", e))?;
    }

    let mut file = File::create(dest)
        .map_err(|e| QuillError::io_error(&format!("failed to create {}", dest.display()), e))?;

    file.write_all(&bytes)
        .map_err(|e| QuillError::io_error("failed to write downloaded file", e))?;

    Ok(())
}

/// Extract a tarball (.tar.gz) to a destination directory.
pub fn extract_tarball(tarball: &Path, dest: &Path) -> Result<()> {
    let file = File::open(tarball)
        .map_err(|e| QuillError::io_error(&format!("failed to open {}", tarball.display()), e))?;

    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);

    archive
        .unpack(dest)
        .map_err(|e| QuillError::io_error("failed to extract tarball", e))?;

    Ok(())
}

/// Create a tarball (.tar.gz) from a directory.
pub fn create_tarball(dir: &Path, output: &Path) -> Result<()> {
    let file = File::create(output)
        .map_err(|e| QuillError::io_error(&format!("failed to create {}", output.display()), e))?;

    let encoder = GzEncoder::new(file, Compression::default());
    let mut builder = tar::Builder::new(encoder);

    // Walk the directory and add all files
    add_dir_to_tar(dir, dir, &mut builder)?;

    builder
        .finish()
        .map_err(|e| QuillError::io_error("failed to finish tarball", e))?;

    Ok(())
}

fn add_dir_to_tar(base: &Path, dir: &Path, builder: &mut tar::Builder<GzEncoder<File>>) -> Result<()> {
    for entry in fs::read_dir(dir)
        .map_err(|e| QuillError::io_error(&format!("failed to read dir {}", dir.display()), e))?
    {
        let entry = entry
            .map_err(|e| QuillError::io_error("failed to read dir entry", e))?;
        let path = entry.path();
        let relative = path.strip_prefix(base).unwrap_or(&path);

        if path.is_file() {
            let mut file = File::open(&path)
                .map_err(|e| QuillError::io_error(&format!("failed to open {}", path.display()), e))?;
            builder
                .append_file(relative, &mut file)
                .map_err(|e| QuillError::io_error(&format!("failed to add {} to tar", path.display()), e))?;
        } else if path.is_dir() {
            add_dir_to_tar(base, &path, builder)?;
        }
    }

    Ok(())
}

/// Copy a file or directory to a destination.
pub fn copy_recursive(src: &Path, dest: &Path) -> Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dest)
            .map_err(|e| QuillError::io_error(&format!("failed to create dir {}", dest.display()), e))?;

        for entry in fs::read_dir(src)
            .map_err(|e| QuillError::io_error(&format!("failed to read dir {}", src.display()), e))?
        {
            let entry = entry
                .map_err(|e| QuillError::io_error("failed to read dir entry", e))?;
            let src_path = entry.path();
            let dest_path = dest.join(src_path.file_name().unwrap());
            copy_recursive(&src_path, &dest_path)?;
        }
    } else {
        fs::copy(src, dest)
            .map_err(|e| QuillError::io_error(&format!("failed to copy {} to {}", src.display(), dest.display()), e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_copy_file() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("source.txt");
        let dest = tmp.path().join("dest.txt");

        fs::write(&src, "hello world").unwrap();
        copy_recursive(&src, &dest).unwrap();

        let contents = fs::read_to_string(&dest).unwrap();
        assert_eq!(contents, "hello world");
    }

    #[test]
    fn test_copy_dir() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        let dest = tmp.path().join("dest");

        fs::create_dir(&src).unwrap();
        fs::write(src.join("a.txt"), "a").unwrap();
        fs::write(src.join("b.txt"), "b").unwrap();

        copy_recursive(&src, &dest).unwrap();

        assert!(dest.join("a.txt").exists());
        assert!(dest.join("b.txt").exists());
    }
}
