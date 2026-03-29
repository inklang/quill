use std::collections::BTreeMap;

use semver::{Version, VersionReq};

/// Registry index structure
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
pub struct RegistryIndex {
    #[serde(default)]
    pub packages: BTreeMap<String, BTreeMap<String, RegistryPackageVersion>>,
}

impl RegistryIndex {
    /// Look up by full name or short name (part after `/`).
    /// e.g., "ink.paper" matches "@scope/ink.paper".
    pub fn get(&self, name: &str) -> Option<&BTreeMap<String, RegistryPackageVersion>> {
        // Try exact match first
        if let Some(pkg) = self.packages.get(name) {
            return Some(pkg);
        }

        // Try short name (part after first `/`)
        if !name.contains('/') {
            for (full_name, pkg) in &self.packages {
                if let Some(short) = full_name.strip_prefix('@') {
                    if let Some(rest) = short.strip_prefix(|c| c != '/') {
                        if rest == name || rest == format!("@{}", name) {
                            return Some(pkg);
                        }
                    }
                    // Handle @scope/name format
                    if let Some((_scope, short_name)) = short.split_once('/') {
                        if short_name == name {
                            return Some(pkg);
                        }
                    }
                }
                // Handle cases without scope prefix
                if let Some((_scope, short_name)) = full_name.split_once('/') {
                    if short_name == name {
                        return Some(pkg);
                    }
                }
            }
        }

        None
    }

    /// Find best version matching semver range or exact version
    pub fn find_best_match<'a>(
        &'a self,
        name: &str,
        range: &'a str,
    ) -> Option<(&'a str, &'a RegistryPackageVersion)> {
        let packages = self.get(name)?;

        // First try to parse as a VersionReq (for ranges like "^1.0.0", ">=1.0.0", etc.)
        let version_req = VersionReq::parse(range).ok();

        if let Some(req) = version_req {
            // Find best matching version
            let mut best_match: Option<(&str, &RegistryPackageVersion)> = None;

            for (version_str, pkg) in packages.iter() {
                if let Ok(version) = Version::parse(version_str) {
                    if req.matches(&version) {
                        match &best_match {
                            None => best_match = Some((version_str, pkg)),
                            Some((current_str, _)) => {
                                if let Ok(current) = Version::parse(current_str) {
                                    if version > current {
                                        best_match = Some((version_str, pkg));
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return best_match;
        }

        // Fall back to exact version match
        packages.get(range).map(|pkg| (range, pkg))
    }
}

/// A specific version of a package in the registry
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct RegistryPackageVersion {
    pub version: String,
    pub url: String,
    #[serde(default)]
    pub dependencies: BTreeMap<String, String>,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub targets: Option<Vec<String>>,
    pub checksum: Option<String>,
    #[serde(default)]
    pub package_type: String,
}

/// Search result from the registry
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct SearchResult {
    pub name: String,
    pub version: String,
    pub description: String,
    pub score: f64,
    #[serde(default)]
    pub package_type: String,
}
