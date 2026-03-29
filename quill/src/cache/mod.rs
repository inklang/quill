pub mod dirty;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub hash: String,
    pub output: String,
    pub compiled_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheManifest {
    pub version: u32,
    pub last_full_build: String,
    pub grammar_ir_hash: Option<String>,
    pub runtime_jar_hash: Option<String>,
    #[serde(default)]
    pub entries: BTreeMap<String, CacheEntry>,
}

impl Default for CacheManifest {
    fn default() -> Self {
        Self {
            version: 1,
            last_full_build: chrono_now(),
            grammar_ir_hash: None,
            runtime_jar_hash: None,
            entries: BTreeMap::new(),
        }
    }
}

fn chrono_now() -> String {
    // Use UTC timestamp in ISO 8601 format
    // We'll use a simple implementation since we don't have chrono as a dep
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // Simple ISO 8601-like format
    format!("{}", secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_manifest_default() {
        let manifest = CacheManifest::default();
        assert_eq!(manifest.version, 1);
        assert!(!manifest.last_full_build.is_empty());
    }

    #[test]
    fn test_cache_entry_serde() {
        let entry = CacheEntry {
            hash: "abc123".to_string(),
            output: "output.inkc".to_string(),
            compiled_at: "1234567890".to_string(),
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: CacheEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.hash, "abc123");
    }
}
