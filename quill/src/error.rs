use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum QuillError {
    #[error("manifest not found at {path}")]
    ManifestNotFound { path: PathBuf },

    #[error("failed to parse manifest at {path}")]
    ManifestParse { path: PathBuf, source: toml::de::Error },

    #[error("failed to parse lockfile at {path}")]
    LockfileParse { path: PathBuf, source: serde_json::Error },

    #[error("{context}")]
    IoError { context: String, source: std::io::Error },

    #[error("registry request failed: {url}")]
    RegistryRequest { url: String, source: reqwest::Error },

    #[error("registry auth: {message}")]
    RegistryAuth { message: String },

    #[error("package not found: {name}{}", version.as_ref().map(|v| format!("@{}", v)).unwrap_or_default())]
    PackageNotFound { name: String, version: Option<String> },

    #[error("resolution conflict for {package}: {ranges:?}")]
    ResolutionConflict { package: String, ranges: Vec<String> },

    #[error("circular dependency: {chain:?}")]
    CircularDependency { chain: Vec<String> },

    #[error("checksum mismatch for {package}: expected {expected}, got {actual}")]
    ChecksumMismatch { package: String, expected: String, actual: String },

    #[error("compiler not found")]
    CompilerNotFound,

    #[error("compiler failed for {script}: {stderr}")]
    CompilerFailed { script: String, stderr: String },

    #[error("grammar parse error at {path}:{line}:{col}: {message}")]
    GrammarParse { path: PathBuf, message: String, line: usize, col: usize },

    #[error("grammar validation failed: {errors:?}")]
    GrammarValidation { errors: Vec<String> },

    #[error("not logged in")]
    NotLoggedIn,

    #[error("login failed: {message}")]
    LoginFailed { message: String },

    #[error("vulnerabilities found: {count}")]
    VulnerabilitiesFound { count: usize },

    #[error("unsafe bytecode in {script}: {operations:?}")]
    UnsafeBytecode { script: String, operations: Vec<String> },

    #[error("target version incompatible for {package}: {message}")]
    TargetVersionIncompatible { package: String, message: String },

    #[error("user cancelled")]
    UserCancelled,
}

impl QuillError {
    pub fn io_error(context: impl Into<String>, source: std::io::Error) -> Self {
        Self::IoError {
            context: context.into(),
            source,
        }
    }
}

pub type Result<T> = std::result::Result<T, QuillError>;
