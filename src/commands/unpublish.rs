use async_trait::async_trait;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::registry::auth::{AuthContext, QuillRc};
use crate::registry::RegistryClient;

pub struct Unpublish {
    pub version: Option<String>,
    pub confirm: bool,
}

#[async_trait]
impl Command for Unpublish {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let manifest = ctx.manifest.as_ref().ok_or_else(|| {
            QuillError::ManifestNotFound {
                path: ctx.project_dir.join("ink-manifest.toml"),
            }
        })?;

        // Check logged in
        let rc = QuillRc::load()?;
        let registry_url = rc.registry.as_str();
        let client = RegistryClient::new(registry_url);
        let auth = AuthContext::from_rc(&rc)?;

        let version = self.version.as_ref()
            .unwrap_or(&manifest.package.version);

        if !self.confirm {
            println!("This will unpublish {}@{}. Are you sure? (use --confirm to proceed)", manifest.package.name, version);
            return Err(QuillError::UserCancelled);
        }

        // Call registry_client.unpublish()
        client.unpublish(&manifest.package.name, version, &auth).await?;

        println!("Unpublished {}@{}", manifest.package.name, version);
        Ok(())
    }
}
