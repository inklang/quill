mod cli;
mod context;
pub mod audit;
pub mod error;
pub mod manifest;
pub mod registry;
pub mod resolve;
pub mod cache;
pub mod grammar;
pub mod util;
pub mod printing_press;

mod commands;

use clap::Parser;
use cli::Cli;
use context::Context;
use commands::Command;
use std::env;

#[tokio::main]
async fn main() -> error::Result<()> {
    let cli = Cli::parse();

    // Handle commands that don't need a manifest before loading project context
    match &cli.commands {
        cli::Commands::Compile { input, output, sources, out, grammar, debug, entry } => {
            let compile_cmd = commands::compile::Compile {
                input: input.clone(),
                output: output.clone(),
                sources: sources.clone(),
                out: out.clone(),
                grammar: grammar.clone(),
                debug: *debug,
                entry: *entry,
            };
            let dummy_ctx = Context::new(
                env::current_dir().map_err(|e| error::QuillError::io_error("failed to get current dir", e))?,
                cli.verbose,
                cli.quiet,
            );
            return compile_cmd.execute(&dummy_ctx).await;
        }
        cli::Commands::Search { query, limit } => {
            let search_cmd = commands::search::Search {
                query: query.clone(),
                limit: *limit,
            };
            let dummy_ctx = Context::new(
                env::current_dir().map_err(|e| error::QuillError::io_error("failed to get current dir", e))?,
                cli.verbose,
                cli.quiet,
            );
            return search_cmd.execute(&dummy_ctx).await;
        }
        _ => {}
    }

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
