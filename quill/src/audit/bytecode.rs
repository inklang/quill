use std::path::Path;
use crate::error::{QuillError, Result};

pub struct BytecodeScanner;

const DISALLOWED_OPS: &[&str] = &[
    "FILE_READ",
    "FILE_WRITE",
    "HTTP_REQUEST",
    "EXEC",
    "EVAL",
    "DB_WRITE",
];

#[derive(Debug)]
pub struct BytecodeViolation {
    pub operation: String,
    pub location: String,
}

impl BytecodeScanner {
    pub fn scan(inkc_path: &Path) -> Result<Vec<BytecodeViolation>> {
        let content = std::fs::read_to_string(inkc_path)
            .map_err(|e| QuillError::io_error("failed to read bytecode file", e))?;

        let bytecode: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to parse bytecode JSON: {}", e),
            })?;

        let mut violations = Vec::new();

        if let Some(ops) = bytecode.get("operations").and_then(|o| o.as_array()) {
            for (idx, op) in ops.iter().enumerate() {
                if let Some(name) = op.get("name").and_then(|n| n.as_str()) {
                    if DISALLOWED_OPS.contains(&name) {
                        violations.push(BytecodeViolation {
                            operation: name.to_string(),
                            location: format!("operations[{}]", idx),
                        });
                    }
                }
            }
        }

        Ok(violations)
    }
}
