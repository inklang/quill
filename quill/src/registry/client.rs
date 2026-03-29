use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::Path;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use reqwest::multipart;
use tokio::fs::File as TokioFile;
use tokio::io::AsyncWriteExt;

use crate::error::{QuillError, Result};
use crate::registry::auth::AuthContext;
use crate::registry::index::{RegistryIndex, SearchResult};

/// A client for interacting with the Ink registry
#[derive(Debug, Clone)]
pub struct RegistryClient {
    client: reqwest::Client,
    base_url: String,
}

impl RegistryClient {
    /// Create a new RegistryClient
    pub fn new(base_url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    /// Fetch the registry index
    pub async fn fetch_index(&self) -> Result<RegistryIndex> {
        let url = format!("{}/index.json", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url: url.clone(),
                source: e,
            })?;

        if !response.status().is_success() {
            return Err(QuillError::RegistryRequest {
                url,
                source: reqwest::Error::from(response.error_for_status_ref().err().unwrap()),
            });
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url,
                source: e,
            })?;

        // Try to decode as gzip, fall back to plain JSON
        let mut decoder = GzDecoder::new(bytes.as_ref());
        let mut decompressed = Vec::new();
        if decoder.read_to_end(&mut decompressed).is_ok() {
            // Successfully decompressed
            let index: RegistryIndex = serde_json::from_slice(&decompressed).map_err(|e| {
                QuillError::RegistryAuth {
                    message: format!("failed to parse registry index: {}", e),
                }
            })?;
            return Ok(index);
        }

        // Not gzip compressed, try plain JSON
        let index: RegistryIndex = serde_json::from_slice(&bytes).map_err(|e| {
            QuillError::RegistryAuth {
                message: format!("failed to parse registry index: {}", e),
            }
        })?;

        Ok(index)
    }

    /// Search packages in the registry
    pub async fn search(&self, query: &str) -> Result<Vec<SearchResult>> {
        let url = format!("{}/api/search?q={}", self.base_url, urlencoding::encode(query));

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url: url.clone(),
                source: e,
            })?;

        if !response.status().is_success() {
            return Err(QuillError::RegistryRequest {
                url,
                source: reqwest::Error::from(response.error_for_status_ref().err().unwrap()),
            });
        }

        let results: Vec<SearchResult> = response
            .json()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url,
                source: e,
            })?;

        Ok(results)
    }

    /// Get package information
    pub async fn get_package_info(
        &self,
        name: &str,
        version: Option<&str>,
    ) -> Result<PackageInfo> {
        let url = if let Some(v) = version {
            format!("{}/api/packages/{}/{}", self.base_url, name, v)
        } else {
            format!("{}/api/packages/{}", self.base_url, name)
        };

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url: url.clone(),
                source: e,
            })?;

        if !response.status().is_success() {
            return Err(QuillError::PackageNotFound {
                name: name.to_string(),
                version: version.map(String::from),
            });
        }

        let info: PackageInfo = response
            .json()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url,
                source: e,
            })?;

        Ok(info)
    }

    /// Publish a package to the registry
    pub async fn publish(
        &self,
        name: &str,
        version: &str,
        tarball: &Path,
        description: &str,
        readme: Option<&str>,
        targets: Option<&[String]>,
        auth: &AuthContext,
    ) -> Result<()> {
        let url = format!("{}/api/packages/{}/{}", self.base_url, name, version);

        // Read and gzip the tarball
        let tarball_file = File::open(tarball)
            .map_err(|e| QuillError::io_error("failed to open tarball", e))?;
        let mut reader = BufReader::new(tarball_file);

        let mut buffer = Vec::new();
        reader.read_to_end(&mut buffer)
            .map_err(|e| QuillError::io_error("failed to read tarball", e))?;

        // Compress with gzip
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&buffer)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to compress tarball: {}", e),
            })?;
        let compressed = encoder.finish()
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to finish compression: {}", e),
            })?;

        // Build multipart form
        let auth_header = auth.make_auth_header();

        let form = multipart::Form::new()
            .part("tarball", multipart::Part::bytes(compressed)
                .mime_str("application/gzip")
                .map_err(|e| QuillError::RegistryAuth {
                    message: format!("failed to set mime type: {}", e),
                })?
                .file_name("package.tar.gz"))
            .text("description", description.to_string());

        let form = if let Some(readme) = readme {
            form.text("readme", readme.to_string())
        } else {
            form
        };

        let form = if let Some(targets) = targets {
            let targets_json = serde_json::to_string(targets).map_err(|e| {
                QuillError::RegistryAuth {
                    message: format!("failed to serialize targets: {}", e),
                }
            })?;
            form.text("targets", targets_json)
        } else {
            form
        };

        let response = self
            .client
            .put(&url)
            .header("Authorization", auth_header)
            .header("Content-Type", "application/vnd.ink-publish+gzip")
            .multipart(form)
            .send()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url: url.clone(),
                source: e,
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(QuillError::RegistryAuth {
                message: format!("publish failed with status {}: {}", status, body),
            });
        }

        Ok(())
    }

    /// Unpublish a package from the registry
    pub async fn unpublish(
        &self,
        name: &str,
        version: &str,
        auth: &AuthContext,
    ) -> Result<()> {
        let url = format!("{}/api/packages/{}/{}", self.base_url, name, version);

        let auth_header = auth.make_auth_header();

        let response = self
            .client
            .delete(&url)
            .header("Authorization", auth_header)
            .send()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url: url.clone(),
                source: e,
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(QuillError::RegistryAuth {
                message: format!("unpublish failed with status {}: {}", status, body),
            });
        }

        Ok(())
    }

    /// Download a package from a URL
    pub async fn download_package(&self, url: &str, dest: &Path) -> Result<()> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url: url.to_string(),
                source: e,
            })?;

        if !response.status().is_success() {
            return Err(QuillError::RegistryRequest {
                url: url.to_string(),
                source: reqwest::Error::from(response.error_for_status_ref().err().unwrap()),
            });
        }

        let mut file = TokioFile::create(dest)
            .await
            .map_err(|e| QuillError::io_error("failed to create destination file", e))?;

        let bytes = response
            .bytes()
            .await
            .map_err(|e| QuillError::RegistryRequest {
                url: url.to_string(),
                source: e,
            })?;

        file.write_all(&bytes)
            .await
            .map_err(|e| QuillError::io_error("failed to write file", e))?;

        Ok(())
    }
}

/// Package information from the registry
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct PackageInfo {
    pub name: String,
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
