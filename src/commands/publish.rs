use async_trait::async_trait;
use std::path::PathBuf;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::registry::auth::{AuthContext, QuillRc};
use crate::registry::RegistryClient;
use crate::util::fs;

pub struct Publish {
    pub access: Option<String>,
    pub dry_run: bool,
    pub no_ignore: bool,
}

#[async_trait]
impl Command for Publish {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-manifest.toml"),
            }
        })?;

        // Check logged in (auth)
        let rc = QuillRc::load()?;

        let registry_url = rc.registry.as_str();
        let client = RegistryClient::new(registry_url);

        let auth = AuthContext::from_rc(&rc)?;

        // Create tarball of project
        let tarball_name = format!("{}-{}.tar.gz",
            manifest.package.name,
            manifest.package.version
        );
        let tarball_path = ctx.project_dir.join(&tarball_name);

        if self.dry_run {
            println!("Dry run - would publish {}@{}", manifest.package.name, manifest.package.version);
            return Ok(());
        }

        // Create tarball for publishing (exclude .git, target, etc.)
        create_publish_tarball(&ctx.project_dir, &tarball_path)?;

        // Call registry_client.publish()
        client.publish(
            &manifest.package.name,
            &manifest.package.version,
            &tarball_path,
            manifest.package.description.as_deref().unwrap_or(""),
            None, // readme
            None, // targets
            &auth,
        ).await?;

        // Clean up tarball
        std::fs::remove_file(&tarball_path)
            .map_err(|e| QuillError::io_error("failed to remove temporary tarball", e))?;

        println!("Published {}@{}", manifest.package.name, manifest.package.version);
        Ok(())
    }
}

fn create_publish_tarball(project_dir: &std::path::Path, output: &std::path::Path) -> Result<()> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use tar::Builder;
    use std::fs::File;

    let file = File::create(output)
        .map_err(|e| QuillError::io_error("failed to create tarball", e))?;
    let encoder = GzEncoder::new(file, Compression::default());
    let mut builder = Builder::new(encoder);

    // Files to exclude from tarball
    let exclude_patterns = vec![".git", "target", "node_modules", ".quill"];

    add_dir_to_tar(project_dir, project_dir, &mut builder, &exclude_patterns)?;

    builder.finish()
        .map_err(|e| QuillError::io_error("failed to finish tarball", e))?;

    Ok(())
}

fn add_dir_to_tar(
    base: &std::path::Path,
    dir: &std::path::Path,
    builder: &mut tar::Builder<flate2::write::GzEncoder<std::fs::File>>,
    exclude_patterns: &[&str],
) -> Result<()> {
    for entry in std::fs::read_dir(dir)
        .map_err(|e| QuillError::io_error(&format!("failed to read dir {}", dir.display()), e))?
    {
        let entry = entry
            .map_err(|e| QuillError::io_error("failed to read dir entry", e))?;
        let path = entry.path();
        let relative = path.strip_prefix(base).unwrap_or(&path);

        // Check if should be excluded
        let should_exclude = exclude_patterns.iter().any(|pattern| {
            relative.to_string_lossy().contains(pattern)
        });

        if should_exclude {
            continue;
        }

        if path.is_file() {
            let mut file = std::fs::File::open(&path)
                .map_err(|e| QuillError::io_error(&format!("failed to open {}", path.display()), e))?;
            builder.append_file(relative, &mut file)
                .map_err(|e| QuillError::io_error(&format!("failed to add {} to tar", path.display()), e))?;
        } else if path.is_dir() {
            add_dir_to_tar(base, &path, builder, exclude_patterns)?;
        }
    }
    Ok(())
}
