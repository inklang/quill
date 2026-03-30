use async_trait::async_trait;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;
use crate::registry::RegistryClient;

pub struct Info {
    pub name: String,
    pub version: Option<String>,
}

#[async_trait]
impl Command for Info {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let registry_url = &ctx.registry_url;
        let client = RegistryClient::new(registry_url);

        // Call registry_client.get_package_info()
        let info = client.get_package_info(&self.name, self.version.as_deref()).await?;

        println!("{}", info.name);
        println!("Version: {}", info.version);
        println!("{}", "-".repeat(40));

        if let Some(desc) = &info.description {
            println!("Description: {}", desc);
        }

        if let Some(homepage) = &info.homepage {
            println!("Homepage: {}", homepage);
        }

        println!("URL: {}", info.url);

        if !info.dependencies.is_empty() {
            println!("Dependencies:");
            for (name, version) in &info.dependencies {
                println!("  {} @ ^{}", name, version);
            }
        }

        if let Some(targets) = &info.targets {
            println!("Targets: {}", targets.join(", "));
        }

        if let Some(exports) = &info.exports {
            println!("\nExports:");
            if !exports.classes.is_empty() {
                println!("  Classes:");
                for (name, class) in &exports.classes {
                    let vis = if class.visibility.is_internal() { " (internal)" } else { "" };
                    println!("    {}{}", name, vis);
                    for method in &class.methods {
                        println!("      .{}()", method);
                    }
                    for method in &class.internal_methods {
                        println!("      .{}() (internal)", method);
                    }
                }
            }
            if !exports.functions.is_empty() {
                println!("  Functions:");
                for (name, vis) in &exports.functions {
                    use crate::exports::Visibility;
                    let vis_label = if matches!(vis, Visibility::Internal) { " (internal)" } else { "" };
                    println!("    {}{}", name, vis_label);
                }
            }
            if !exports.grammars.is_empty() {
                println!("  Grammars:");
                for g in &exports.grammars {
                    println!("    {}", g);
                }
            }
        }

        Ok(())
    }
}
