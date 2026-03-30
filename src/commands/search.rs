use async_trait::async_trait;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;
use crate::registry::RegistryClient;

pub struct Search {
    pub query: String,
    pub limit: Option<usize>,
}

#[async_trait]
impl Command for Search {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let registry_url = &ctx.registry_url;
        let client = RegistryClient::new(registry_url);

        // Call registry_client.search()
        let results = client.search(&self.query).await?;

        let limit = self.limit.unwrap_or(results.len());

        if results.is_empty() {
            println!("No packages found matching '{}'", self.query);
        } else {
            println!("Search results for '{}':", self.query);
            println!("{:<30} {:<10} {:<40}", "Name", "Version", "Description");
            println!("{}", "-".repeat(80));

            for result in results.iter().take(limit) {
                let description = result.description
                    .chars()
                    .take(37)
                    .collect::<String>();
                println!("{:<30} {:<10} {:.<40}",
                    result.name,
                    result.version,
                    description
                );
            }

            println!("\n{} packages found", results.len());
        }

        Ok(())
    }
}
