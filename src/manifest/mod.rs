pub mod toml;
pub mod lockfile;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub use toml::{PackageManifest, PackageInfo, GrammarConfig, BuildConfig, RuntimeConfig, ServerConfig, TargetConfig};
pub use lockfile::{Lockfile, LockedPackage};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PackageType {
    Script,
    Library,
}
