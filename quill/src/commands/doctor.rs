use async_trait::async_trait;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;
use crate::registry::auth::QuillRc;
use crate::registry::RegistryClient;
use crate::util::compiler::resolve_compiler;

pub struct Doctor;

#[async_trait]
impl Command for Doctor {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        println!("Running diagnostics...\n");

        let mut all_ok = true;

        // Check compiler available
        println!("Checking compiler...");
        match resolve_compiler() {
            Ok(path) => println!("  [OK] Compiler found: {}", path.display()),
            Err(_) => {
                println!("  [WARN] Compiler not found");
                println!("         Install with: quill doctor --install-compiler");
                all_ok = false;
            }
        }

        // Check registry reachable
        println!("\nChecking registry...");
        let client = RegistryClient::new(&ctx.registry_url);
        match client.fetch_index().await {
            Ok(_) => println!("  [OK] Registry reachable: {}", ctx.registry_url),
            Err(e) => {
                println!("  [WARN] Registry unreachable: {}", e);
                all_ok = false;
            }
        }

        // Check logged in state
        println!("\nChecking authentication...");
        match QuillRc::load() {
            Ok(rc) => {
                println!("  [OK] Logged in as: {}", rc.username);
                println!("       Registry: {}", rc.registry);
            }
            Err(crate::error::QuillError::NotLoggedIn) => {
                println!("  [INFO] Not logged in (this is fine for public packages)");
            }
            Err(e) => {
                println!("  [WARN] Auth error: {}", e);
            }
        }

        // Check manifest valid
        println!("\nChecking manifest...");
        if let Some(ref manifest) = ctx.manifest {
            println!("  [OK] Manifest valid");
            println!("       Package: {}@{}", manifest.package.name, manifest.package.version);
        } else {
            let manifest_path = ctx.project_dir.join("ink-manifest.toml");
            if manifest_path.exists() {
                println!("  [WARN] Manifest exists but failed to parse");
                all_ok = false;
            } else {
                println!("  [INFO] No manifest in current directory");
            }
        }

        // Check lockfile
        println!("\nChecking lockfile...");
        if let Some(ref lockfile) = ctx.lockfile {
            println!("  [OK] Lockfile valid");
            println!("       {} packages locked", lockfile.packages.len());
        } else {
            let lockfile_path = ctx.project_dir.join("quill.lock");
            if lockfile_path.exists() {
                println!("  [WARN] Lockfile exists but failed to parse");
            } else {
                println!("  [INFO] No lockfile (run 'quill install')");
            }
        }

        println!();
        if all_ok {
            println!("All checks passed!");
        } else {
            println!("Some checks failed. See above for details.");
        }

        Ok(())
    }
}
