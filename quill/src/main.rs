mod cli;
mod context;
pub mod error;
pub mod manifest;
pub mod registry;
pub mod resolve;
pub mod cache;
pub mod grammar;
pub mod util;

mod commands;

use clap::Parser;
use cli::Cli;
use context::Context;
use std::env;

#[tokio::main]
async fn main() -> error::Result<()> {
    let cli = Cli::parse();

    let project_dir = env::current_dir()
        .map_err(|e| error::QuillError::io_error("failed to get current dir", e))?;

    let mut ctx = Context::new(
        project_dir,
        cli.verbose,
        cli.quiet,
    );

    ctx.load_manifest()?;
    ctx.load_lockfile()?;

    // Load ~/.quillrc if present
    if let Some(home) = env::var_os("HOME") {
        let rc_path = std::path::PathBuf::from(home).join(".quillrc");
        if rc_path.exists() {
            // Placeholder - will be implemented in later chunk
            let _ = rc_path;
        }
    }

    commands::execute(&ctx, &cli.commands).await?;

    Ok(())
}
