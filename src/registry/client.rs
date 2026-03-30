use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::Path;

use indicatif::ProgressBar;

use crate::exports::PackageExports;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
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
                    message: format!("failed to parse gzip-compressed registry index: {}", e),
                }
            })?;
            return Ok(index);
        }

        // Not gzip compressed, try plain JSON
        let index: RegistryIndex = serde_json::from_slice(&bytes).map_err(|e| {
            QuillError::RegistryAuth {
                message: format!("failed to parse registry index JSON: {}", e),
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
        _description: &str,
        _readme: Option<&str>,
        _targets: Option<&[String]>,
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

        // Send raw gzip body per spec: PUT /api/packages/{name}/{version}
        // Content-Type: application/vnd.ink-publish+gzip
        let auth_header = auth.make_auth_header();

        let response = self
            .client
            .put(&url)
            .header("Authorization", auth_header)
            .header("Content-Type", "application/vnd.ink-publish+gzip")
            .body(compressed)
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

    /// Download a package from a URL, streaming chunks into dest.
    /// Pass a ProgressBar to show byte progress; pass None for silent download.
    pub async fn download_package(
        &self,
        url: &str,
        dest: &Path,
        pb: Option<&ProgressBar>,
    ) -> Result<()> {
        use futures_util::StreamExt;

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
                source: response.error_for_status_ref().unwrap_err(),
            });
        }

        if let (Some(pb), Some(len)) = (pb, response.content_length()) {
            pb.set_length(len);
        }

        let mut file = TokioFile::create(dest)
            .await
            .map_err(|e| QuillError::io_error("failed to create destination file", e))?;

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| QuillError::RegistryRequest {
                url: url.to_string(),
                source: e,
            })?;
            file.write_all(&chunk)
                .await
                .map_err(|e| QuillError::io_error("failed to write chunk", e))?;
            if let Some(pb) = pb {
                pb.inc(chunk.len() as u64);
            }
        }

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exports: Option<PackageExports>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn test_download_package_streams_to_file() {
        let server = MockServer::start().await;
        let body = b"fake tarball content";

        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(body.as_slice())
                    .append_header("content-length", body.len().to_string()),
            )
            .mount(&server)
            .await;

        let dir = tempdir().unwrap();
        let dest = dir.path().join("package.tar.gz");
        // RegistryClient::new stores a base URL but download_package uses the passed URL
        // directly — construct with an empty string to make this clear.
        let client = RegistryClient::new("");

        client
            .download_package(&format!("{}/pkg.tar.gz", server.uri()), &dest, None)
            .await
            .unwrap();

        let written = std::fs::read(&dest).unwrap();
        assert_eq!(written, body);
    }
}
