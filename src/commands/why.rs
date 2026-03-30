use async_trait::async_trait;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;

pub struct Why {
    pub package: String,
}

#[async_trait]
impl Command for Why {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            crate::error::QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-manifest.toml"),
            }
        })?;

        let lockfile = ctx.lockfile.as_ref().ok_or_else(|| {
            crate::error::QuillError::io_error(
                "lockfile not found",
                std::io::Error::new(std::io::ErrorKind::NotFound, "lockfile not found")
            )
        })?;

        let target = &self.package;

        // Check if it's a direct dependency
        if manifest.dependencies.contains_key(target) {
            println!("{} is a direct dependency in ink-manifest.toml", target);
        }

        // Trace through lockfile to find dependency chain
        fn find_in_deps(
            packages: &std::collections::BTreeMap<String, crate::manifest::LockedPackage>,
            target: &str,
            visited: &mut std::collections::HashSet<String>,
        ) -> Option<Vec<String>> {
            if visited.contains(target) {
                return None;
            }
            visited.insert(target.to_string());

            for (name, pkg) in packages {
                if pkg.dependencies.iter().any(|d| d == target) {
                    let mut chain = vec![name.clone()];
                    if let Some(sub) = find_in_deps(packages, name, visited) {
                        chain.extend(sub);
                    }
                    return Some(chain);
                }
            }
            None
        }

        let mut visited = std::collections::HashSet::new();
        if let Some(chain) = find_in_deps(&lockfile.packages, target, &mut visited) {
            println!("{} is depended on by:", target);
            for (i, name) in chain.iter().enumerate() {
                let indent = "  ".repeat(i);
                println!("{}{}", indent, name);
            }
        } else if !manifest.dependencies.contains_key(target) {
            println!("{} is not a direct dependency", target);
        }

        if let Some(pkg) = lockfile.packages.get(target) {
            println!("\nVersion: {}", pkg.version);
            if !pkg.dependencies.is_empty() {
                println!("Dependencies: {}", pkg.dependencies.join(", "));
            }
        }

        Ok(())
    }
}
