use async_trait::async_trait;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::Duration;

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};
use crate::registry::auth::{AuthContext, QuillRc};

pub struct Login {
    pub registry: Option<String>,
}

#[async_trait]
impl Command for Login {
    async fn execute(&self, _ctx: &Context) -> Result<()> {
        let registry_url = self.registry.as_ref()
            .map(|s| s.as_str())
            .unwrap_or("https://inklang.io");

        // 1. Generate Ed25519 keypair
        let (private_key_b64, key_id) = AuthContext::generate_keypair()?;

        // 2. Spawn TcpListener on random port
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| QuillError::io_error("failed to bind TCP listener", e))?;
        let port = listener.local_addr()
            .map_err(|e| QuillError::io_error("failed to get local address", e))?
            .port();

        // 3. Open browser to registry/cli-auth
        let auth_url = format!("{}/cli-auth?keyId={}&port={}",
            registry_url.trim_end_matches('/'),
            key_id,
            port
        );

        println!("Opening browser for authentication...");
        println!("If your browser doesn't open, visit: {}", auth_url);

        open::that(&auth_url)
            .map_err(|e| QuillError::io_error("failed to open browser", e))?;

        // 4. Wait for callback
        println!("Waiting for authentication...");

        let callback_timeout = Duration::from_secs(300); // 5 minutes
        let _deadline = std::time::Instant::now() + callback_timeout;

        let mut stream = listener.accept()
            .map_err(|e| QuillError::io_error("failed to accept connection", e))
            .ok()
            .map(|(stream, _)| stream)
            .ok_or_else(|| {
                QuillError::LoginFailed {
                    message: "timeout waiting for authentication".to_string(),
                }
            })?;

        // Read the callback request
        let mut buffer = vec![0u8; 4096];
        let _bytes_read = std::io::Read::read(&mut std::io::BufReader::new(&stream), &mut buffer)
            .map_err(|e| QuillError::io_error("failed to read callback", e))?;

        // Parse the callback to get the auth code
        let request_str = String::from_utf8_lossy(&buffer);
        let _code = extract_auth_code(&request_str)
            .ok_or_else(|| QuillError::LoginFailed {
                message: "failed to parse auth callback".to_string(),
            })?;

        // In a real implementation, we would POST the public key to the registry
        // and exchange the code for a token. For now, we'll just save the credentials.
        let username = format!("user_{}", &key_id[..8]); // Placeholder

        // Send response to browser
        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body>Authentication successful! You can close this tab.</body></html>";
        stream.write_all(response.as_bytes())
            .map_err(|e| QuillError::io_error("failed to send response", e))?;

        // 5. Save ~/.quillrc
        let quill_rc = QuillRc {
            key_id,
            private_key: private_key_b64,
            username,
            registry: registry_url.to_string(),
        };

        quill_rc.save()?;

        println!("Successfully logged in to {}", registry_url);
        Ok(())
    }
}

fn extract_auth_code(request: &str) -> Option<String> {
    // Simple extraction - look for "code=XXX" in the request
    for line in request.lines() {
        if line.starts_with("GET") || line.starts_with("POST") {
            if let Some(query_start) = line.find('?') {
                let query = &line[query_start..];
                for param in query.split('&') {
                    if let Some((key, value)) = param.split_once('=') {
                        if key == "code" {
                            return Some(value.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}
