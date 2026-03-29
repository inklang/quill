use async_trait::async_trait;
use crate::context::Context;
use crate::error::Result;

pub mod add;
pub mod audit;
pub mod build;
pub mod cache_clean;
pub mod cache_info;
pub mod cache_ls;
pub mod clean;
pub mod completions;
pub mod doctor;
pub mod info;
pub mod install;
pub mod login;
pub mod logout;
pub mod ls;
pub mod new;
pub mod outdated;
pub mod pack;
pub mod publish;
pub mod remove;
pub mod search;
pub mod unpublish;
pub mod update;
pub mod why;

pub use add::Add;
pub use audit::Audit;
pub use build::Build;
pub use cache_clean::CacheClean;
pub use cache_info::CacheInfo;
pub use cache_ls::CacheLs;
pub use clean::Clean;
pub use completions::Completions;
pub use doctor::Doctor;
pub use info::Info;
pub use install::Install;
pub use login::Login;
pub use logout::Logout;
pub use ls::Ls;
pub use new::New;
pub use outdated::Outdated;
pub use pack::Pack;
pub use publish::Publish;
pub use remove::Remove;
pub use search::Search;
pub use unpublish::Unpublish;
pub use update::Update;
pub use why::Why;

#[async_trait]
pub trait Command: Send + Sync {
    async fn execute(&self, ctx: &Context) -> Result<()>;
}

pub async fn execute(ctx: &Context, command: &crate::cli::Commands) -> Result<()> {
    match command {
        crate::cli::Commands::New { path, name, kind } => {
            New { path: path.clone(), name: name.clone(), kind: kind.clone() }.execute(ctx).await
        }
        crate::cli::Commands::Add { version, registry, packages } => {
            Add { version: version.clone(), registry: registry.clone(), packages: packages.clone() }.execute(ctx).await
        }
        crate::cli::Commands::Remove { packages } => {
            Remove { packages: packages.clone() }.execute(ctx).await
        }
        crate::cli::Commands::Install { frozen, offline } => {
            Install { frozen: *frozen, offline: *offline }.execute(ctx).await
        }
        crate::cli::Commands::Update { precision, recursive, packages } => {
            Update { precision: precision.clone(), recursive: *recursive, packages: packages.clone() }.execute(ctx).await
        }
        crate::cli::Commands::Outdated { precision, hide } => {
            Outdated { precision: precision.clone(), hide: hide.clone() }.execute(ctx).await
        }
        crate::cli::Commands::Ls { tree, depth } => {
            Ls { tree: *tree, depth: *depth }.execute(ctx).await
        }
        crate::cli::Commands::Why { package } => {
            Why { package: package.clone() }.execute(ctx).await
        }
        crate::cli::Commands::Build { output, target } => {
            Build { output: output.clone(), target: target.clone() }.execute(ctx).await
        }
        crate::cli::Commands::Clean => {
            Clean.execute(ctx).await
        }
        crate::cli::Commands::Pack { allow_dirty } => {
            Pack { allow_dirty: *allow_dirty }.execute(ctx).await
        }
        crate::cli::Commands::Publish { access, dry_run, no_ignore } => {
            Publish { access: access.clone(), dry_run: *dry_run, no_ignore: *no_ignore }.execute(ctx).await
        }
        crate::cli::Commands::Unpublish { version, confirm } => {
            Unpublish { version: version.clone(), confirm: *confirm }.execute(ctx).await
        }
        crate::cli::Commands::Search { query, limit } => {
            Search { query: query.clone(), limit: *limit }.execute(ctx).await
        }
        crate::cli::Commands::Info { name, version } => {
            Info { name: name.clone(), version: version.clone() }.execute(ctx).await
        }
        crate::cli::Commands::Login { registry } => {
            Login { registry: registry.clone() }.execute(ctx).await
        }
        crate::cli::Commands::Logout { registry } => {
            Logout { registry: registry.clone() }.execute(ctx).await
        }
        crate::cli::Commands::Audit { fix, severities, no_ignore } => {
            Audit { fix: *fix, severities: severities.clone(), no_ignore: *no_ignore }.execute(ctx).await
        }
        crate::cli::Commands::Doctor => {
            Doctor.execute(ctx).await
        }
        crate::cli::Commands::Cache { command } => {
            match command {
                crate::cli::CacheCommands::Info => {
                    CacheInfo.execute(ctx).await
                }
                crate::cli::CacheCommands::Clean => {
                    CacheClean.execute(ctx).await
                }
                crate::cli::CacheCommands::Ls => {
                    CacheLs.execute(ctx).await
                }
            }
        }
        crate::cli::Commands::Completions { shell } => {
            Completions { shell: shell.clone() }.execute(ctx).await
        }
    }
}
