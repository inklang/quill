use async_trait::async_trait;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;

pub struct Ls {
    pub tree: bool,
    pub depth: Option<usize>,
}

#[async_trait]
impl Command for Ls {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let lockfile = ctx.lockfile.as_ref().ok_or_else(|| {
            crate::error::QuillError::io_error(
                "lockfile not found",
                std::io::Error::new(std::io::ErrorKind::NotFound, "lockfile not found")
            )
        })?;

        if self.tree {
            print_tree(&lockfile.packages, &ctx.project_dir, 0, self.depth.unwrap_or(usize::MAX));
        } else {
            println!("Installed packages:");
            println!("{:<30} {:<15}", "Package", "Version");
            println!("{}", "-".repeat(45));
            for (name, pkg) in &lockfile.packages {
                println!("{:<30} {:<15}", name, pkg.version);
            }
            println!("\n{} packages installed", lockfile.packages.len());
        }

        Ok(())
    }
}

fn print_tree(
    packages: &std::collections::BTreeMap<String, crate::manifest::LockedPackage>,
    _project_dir: &std::path::Path,
    depth: usize,
    max_depth: usize,
) {
    if depth >= max_depth {
        return;
    }

    let indent = "  ".repeat(depth);
    for (name, pkg) in packages {
        println!("{}{}@^{}", indent, name, pkg.version);
    }
}
