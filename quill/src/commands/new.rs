use async_trait::async_trait;
use std::fs;
use std::path::PathBuf;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::manifest::{PackageManifest, PackageInfo, PackageType};

pub struct New {
    pub path: PathBuf,
    pub name: Option<String>,
    pub kind: crate::cli::PackageType,
}

#[async_trait]
impl Command for New {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let project_path = if self.path == PathBuf::from(".") {
            ctx.project_dir.clone()
        } else {
            self.path.clone()
        };

        // Determine package name from directory name if not specified
        let name = if let Some(ref n) = self.name {
            n.clone()
        } else {
            project_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("my-package")
                .to_string()
        };

        // Convert package type
        let package_type = match self.kind {
            crate::cli::PackageType::Script => PackageType::Script,
            crate::cli::PackageType::Library => PackageType::Library,
        };

        // Create project structure
        fs::create_dir_all(project_path.join("src"))
            .map_err(|e| QuillError::io_error("failed to create src directory", e))?;

        // Create manifest
        let manifest = PackageManifest {
            package: PackageInfo {
                name: name.clone(),
                version: "0.1.0".to_string(),
                package_type: Some(package_type),
                description: None,
                author: None,
                homepage: None,
                repository: None,
                main: Some("src/main.ink".to_string()),
                target: None,
            },
            dependencies: std::collections::BTreeMap::new(),
            grammar: None,
            build: Some(crate::manifest::BuildConfig {
                entry: Some("src/main.ink".to_string()),
                compiler: None,
                target: None,
                target_version: None,
            }),
            runtime: None,
            server: None,
            targets: std::collections::BTreeMap::new(),
        };

        let manifest_path = project_path.join("ink-manifest.toml");
        let manifest_content = toml::to_string_pretty(&manifest)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to serialize manifest: {}", e),
            })?;

        fs::write(&manifest_path, manifest_content)
            .map_err(|e| QuillError::io_error("failed to write manifest", e))?;

        // Create main.ink
        let main_ink = project_path.join("src").join("main.ink");
        fs::write(&main_ink, "// Your script here\n")
            .map_err(|e| QuillError::io_error("failed to create main.ink", e))?;

        println!("Created new {} package: {}", name, manifest_path.display());
        Ok(())
    }
}
