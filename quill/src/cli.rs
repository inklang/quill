use clap::{Parser, Subcommand, ValueEnum};

#[derive(Parser, Debug)]
#[command(
    name = "quill",
    about = "The Ink package manager",
    version
)]
pub struct Cli {
    #[arg(long, global = true)]
    pub verbose: bool,

    #[arg(long, global = true)]
    pub quiet: bool,

    #[command(subcommand)]
    pub commands: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Create a new package
    New {
        #[arg(short, long, default_value = ".")]
        path: std::path::PathBuf,

        #[arg(short, long)]
        name: Option<String>,

        #[arg(short, long, value_enum, default_value = "script")]
        kind: PackageType,
    },

    /// Add a dependency
    Add {
        #[arg(short, long)]
        version: Option<String>,

        #[arg(short, long)]
        registry: Option<String>,

        packages: Vec<String>,
    },

    /// Remove a dependency
    Remove {
        packages: Vec<String>,
    },

    /// Install dependencies
    Install {
        #[arg(short, long)]
        frozen: bool,

        #[arg(short, long)]
        offline: bool,
    },

    /// Update dependencies
    Update {
        #[arg(short, long)]
        precision: Option<String>,

        #[arg(long)]
        recursive: bool,

        packages: Vec<String>,
    },

    /// List outdated dependencies
    Outdated {
        #[arg(short, long)]
        precision: Option<String>,

        #[arg(long)]
        hide: Vec<String>,
    },

    /// List installed packages
    Ls {
        #[arg(short, long)]
        tree: bool,

        #[arg(long)]
        depth: Option<usize>,
    },

    /// Explain why a package is installed
    Why {
        package: String,
    },

    /// Build the package
    Build {
        #[arg(short, long)]
        output: Option<std::path::PathBuf>,

        #[arg(long)]
        target: Option<String>,
    },

    /// Clean build artifacts
    Clean,

    /// Package the library
    Pack {
        #[arg(short, long)]
        allow_dirty: bool,
    },

    /// Publish to registry
    Publish {
        #[arg(short, long)]
        access: Option<String>,

        #[arg(long)]
        dry_run: bool,

        #[arg(long)]
        no_ignore: bool,
    },

    /// Remove a published package
    Unpublish {
        #[arg(short, long)]
        version: Option<String>,

        #[arg(long)]
        confirm: bool,
    },

    /// Search registry
    Search {
        query: String,

        #[arg(short, long)]
        limit: Option<usize>,
    },

    /// View package info
    Info {
        name: String,

        #[arg(short, long)]
        version: Option<String>,
    },

    /// Login to registry
    Login {
        #[arg(short, long)]
        registry: Option<String>,
    },

    /// Logout from registry
    Logout {
        #[arg(short, long)]
        registry: Option<String>,
    },

    /// Audit for vulnerabilities
    Audit {
        #[arg(short, long)]
        fix: bool,

        #[arg(long)]
        severities: Vec<String>,

        #[arg(long)]
        no_ignore: bool,
    },

    /// Check for issues
    Doctor,

    /// Cache management
    Cache {
        #[command(subcommand)]
        command: CacheCommands,
    },

    /// Generate shell completions
    Completions {
        #[arg(value_enum, default_value = "bash")]
        shell: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum CacheCommands {
    /// Show cache info
    Info,
    /// Clean cache
    Clean,
    /// List cache contents
    Ls,
}

#[derive(ValueEnum, Debug, Clone)]
pub enum PackageType {
    Script,
    Library,
}
