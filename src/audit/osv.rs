use serde::{Deserialize, Serialize};
use crate::error::{QuillError, Result};

pub struct OsvClient {
    client: reqwest::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsvQuery {
    pub package: Package,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Package {
    pub name: String,
    pub ecosystem: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsvResponse {
    #[serde(default)]
    pub vulns: Vec<Vulnerability>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Vulnerability {
    pub id: String,
    pub summary: String,
    pub severity: Option<Severity>,
    #[serde(default)]
    pub references: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

impl OsvClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    pub async fn scan(&self, package: &str, version: &str) -> Result<Vec<Vulnerability>> {
        let query = OsvQuery {
            package: Package {
                name: package.to_string(),
                ecosystem: "Ink".to_string(),
            },
            version: version.to_string(),
        };

        let response = self.client
            .post("https://api.osv.dev/v1/query")
            .json(&query)
            .send()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url: "https://api.osv.dev/v1/query".to_string(),
                source: e,
            })?;

        let osv_response: OsvResponse = response
            .json()
            .await
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to parse OSV response: {}", e),
            })?;

        Ok(osv_response.vulns)
    }
}

impl Default for OsvClient {
    fn default() -> Self {
        Self::new()
    }
}
