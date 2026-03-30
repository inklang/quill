use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::{PackageType, PackageManifest as Manifest};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
    #[serde(rename = "type", default)]
    pub package_type: Option<PackageType>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub main: Option<String>,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct GrammarConfig {
    pub entry: Option<String>,
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct BuildConfig {
    pub entry: Option<String>,
    pub compiler: Option<String>,
    pub target: Option<String>,
    #[serde(rename = "target-version", default)]
    pub target_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RuntimeConfig {
    #[serde(rename = "jvm-args", default)]
    pub jvm_args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct ServerConfig {
    pub paper: Option<String>,
    pub jar: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct TargetConfig {
    pub entry: Option<String>,
    pub jar: Option<String>,
    #[serde(rename = "jvm-args", default)]
    pub jvm_args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<BTreeMap<String, String>>,
    #[serde(rename = "target-version", default)]
    pub target_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct PackageManifest {
    #[serde(rename = "package")]
    pub package: PackageInfo,
    #[serde(default)]
    pub dependencies: BTreeMap<String, String>,
    #[serde(default)]
    pub grammar: Option<GrammarConfig>,
    #[serde(default)]
    pub build: Option<BuildConfig>,
    #[serde(default)]
    pub runtime: Option<RuntimeConfig>,
    #[serde(default)]
    pub server: Option<ServerConfig>,
    #[serde(default)]
    pub targets: BTreeMap<String, TargetConfig>,
}
