use async_trait::async_trait;
use std::path::PathBuf;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::registry::auth::QuillRc;

pub struct Logout {
    pub registry: Option<String>,
}

#[async_trait]
impl Command for Logout {
    async fn execute(&self, _ctx: &Context) -> Result<()> {
        let home = std::env::var("HOME")
            .map_err(|_| QuillError::RegistryAuth {
                message: "HOME environment variable not set".to_string(),
            })?;

        let rc_path: PathBuf = std::path::PathBuf::from(home).join(".quillrc");

        if !rc_path.exists() {
            println!("Not logged in");
            return Ok(());
        }

        // Load and verify registry matches if specified
        if let Ok(rc) = QuillRc::load() {
            if let Some(ref reg) = self.registry {
                if rc.registry != *reg {
                    println!("Not logged in to {}", reg);
                    return Ok(());
                }
            }

            // In a full implementation, we would call DELETE /api/auth/token
            // to revoke the token with the registry
            let _ = rc; // suppress unused warning
        }

        // Delete ~/.quillrc
        std::fs::remove_file(&rc_path)
            .map_err(|e| QuillError::io_error("failed to remove .quillrc", e))?;

        println!("Logged out");
        Ok(())
    }
}
