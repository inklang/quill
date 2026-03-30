use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ed25519_dalek::Signer;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

use crate::error::{QuillError, Result};

/// Represents the ~/.quillrc file contents
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QuillRc {
    pub key_id: String,
    pub private_key: String, // PKCS8 DER, base64-encoded
    pub username: String,
    pub registry: String,
}

impl QuillRc {
    /// Load QuillRc from ~/.quillrc
    pub fn load() -> Result<Self> {
        let path = Self::path()?;
        if !path.exists() {
            return Err(QuillError::NotLoggedIn);
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| QuillError::io_error("failed to read .quillrc", e))?;

        serde_json::from_str(&content)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to parse .quillrc: {}", e),
            })
    }

    /// Save QuillRc to ~/.quillrc
    pub fn save(&self) -> Result<()> {
        let path = Self::path()?;
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to serialize .quillrc: {}", e),
            })?;

        fs::write(&path, content)
            .map_err(|e| QuillError::io_error("failed to write .quillrc", e))?;

        // Set file permissions to 0o600
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path)
                .map_err(|e| QuillError::io_error("failed to get file permissions", e))?
                .permissions();
            perms.set_mode(0o600);
            fs::set_permissions(&path, perms)
                .map_err(|e| QuillError::io_error("failed to set file permissions", e))?;
        }

        Ok(())
    }

    /// Get the path to ~/.quillrc
    fn path() -> Result<PathBuf> {
        let home = std::env::var("HOME")
            .map_err(|_| QuillError::RegistryAuth {
                message: "HOME environment variable not set".to_string(),
            })?;
        Ok(PathBuf::from(home).join(".quillrc"))
    }
}

/// Authentication context for signing requests
#[derive(Debug, Clone)]
pub struct AuthContext {
    pub key_id: String,
    signing_key: ed25519_dalek::SigningKey,
}

impl AuthContext {
    /// Create AuthContext from a QuillRc
    pub fn from_rc(rc: &QuillRc) -> Result<Self> {
        // Decode PKCS8 DER base64 -> SigningKey via pkcs8::DecodePrivateKey
        let der_bytes = BASE64
            .decode(&rc.private_key)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to decode private key base64: {}", e),
            })?;

        let signing_key = pkcs8::DecodePrivateKey::from_pkcs8_der(&der_bytes)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to parse PKCS8 DER: {}", e),
            })?;

        Ok(Self {
            key_id: rc.key_id.clone(),
            signing_key,
        })
    }

    /// Generate a new keypair, returning (private_key_b64, key_id)
    pub fn generate_keypair() -> Result<(String, String)> {
        let mut secret_key_bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut secret_key_bytes);
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&secret_key_bytes);
        let verifying_key = signing_key.verifying_key();

        // Encode signing key to PKCS8 DER
        let pkcs8_bytes = pkcs8::EncodePrivateKey::to_pkcs8_der(&signing_key)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to encode signing key: {}", e),
            })?;

        let private_key_b64 = BASE64.encode(pkcs8_bytes.as_bytes());

        // Compute key_id from SHA256 of SPKI bytes
        // Ed25519 SPKI OID: 1.3.101.112 (.len = 3)
        // Sequence: AlgorithmIdentifier || CurveIdentifier || PublicKey
        let public_key_bytes = verifying_key.as_bytes();
        let spki = Self::build_ed25519_spki(public_key_bytes);
        let mut hasher = Sha256::new();
        hasher.update(&spki);
        let hash = hasher.finalize();
        let key_id = hex::encode(&hash[..16]); // First 16 bytes = 32 hex chars

        Ok((private_key_b64, key_id))
    }

    /// Build Ed25519 SPKI DER from public key bytes
    fn build_ed25519_spki(public_key: &[u8; 32]) -> Vec<u8> {
        // Ed25519 OID: 1.3.101.112
        let ed25519_oid = &[0x40, 0x06, 0x2B, 0x65, 0x03, 0x65, 0x6B, 0x01, 0x0B];
        // NULL for parameters (0x05 0x00)
        let null_params = &[0x05, 0x00];
        // OCTET STRING containing the 32-byte public key
        let key_octet = [0x03, 0x21, 0x00].iter()
            .chain(public_key.iter())
            .copied()
            .collect::<Vec<u8>>();
        // SEQUENCE of { OID, NULL } || OCTET STRING
        let inner = ed25519_oid.iter()
            .chain(null_params.iter())
            .chain(key_octet.iter())
            .copied()
            .collect::<Vec<u8>>();
        // Wrap in SEQUENCE
        let inner_len = inner.len() as u8;
        [0x30, inner_len]
            .iter()
            .chain(inner.iter())
            .copied()
            .collect()
    }

    /// Make the authentication header value
    /// Format: "Ink-v1 keyId=...,ts=...,sig=..."
    //
    // Note: Timestamp-only replay protection. Matches existing Ink-v1 protocol.
    pub fn make_auth_header(&self) -> String {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let message = format!("{}.{}", self.key_id, timestamp);
        let signature = self.signing_key.sign(message.as_bytes());
        let sig_b64 = BASE64.encode(signature.to_bytes());

        format!("Ink-v1 keyId={},ts={},sig={}", self.key_id, timestamp, sig_b64)
    }
}
