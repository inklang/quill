use async_trait::async_trait;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};

pub struct Completions {
    pub shell: String,
}

#[async_trait]
impl Command for Completions {
    async fn execute(&self, _ctx: &Context) -> Result<()> {
        use clap::CommandFactory;

        // Generate shell completions using clap
        let shell = match self.shell.to_lowercase().as_str() {
            "bash" => clap_complete::Shell::Bash,
            "fish" => clap_complete::Shell::Fish,
            "zsh" => clap_complete::Shell::Zsh,
            "powershell" => clap_complete::Shell::PowerShell,
            "elvish" => clap_complete::Shell::Elvish,
            _ => {
                return Err(QuillError::RegistryAuth {
                    message: format!("unknown shell: {}. Supported: bash, fish, zsh, powershell, elvish", self.shell),
                });
            }
        };

        let mut cmd = crate::cli::Cli::command();
        let name = cmd.get_name().to_string();

        let mut buf = Vec::new();
        clap_complete::generate(shell, &mut cmd, name, &mut buf);

        // Write to stdout or a file
        let output = String::from_utf8(buf)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to generate completions: {}", e),
            })?;

        println!("{}", output);
        Ok(())
    }
}
