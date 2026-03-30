use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

use crate::error::{QuillError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lockfile {
    pub version: u32,
    pub registry: String,
    #[serde(default)]
    pub packages: BTreeMap<String, LockedPackage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockedPackage {
    pub version: String,
    #[serde(rename = "resolutionSource")]
    pub resolution_source: String,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

impl Lockfile {
    pub fn load(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| QuillError::io_error("failed to read lockfile", e))?;

        serde_json::from_str(&content)
            .map_err(|e| QuillError::lockfile_parse_error(path.to_path_buf(), e))
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| QuillError::LockfileSerialize {
                path: path.to_path_buf(),
                message: e.to_string(),
            })?;

        std::fs::write(path, content)
            .map_err(|e| QuillError::io_error("failed to write lockfile", e))
    }
}
