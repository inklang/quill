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
            .map_err(|e| QuillError::LockfileParse {
                path: inkc_path.to_path_buf(),
                source: e,
            })?;

        let mut violations = Vec::new();

        // Check if operations field exists and is an array
        if let Some(ops_value) = bytecode.get("operations") {
            if let Some(ops) = ops_value.as_array() {
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
            } else {
                eprintln!("Warning: 'operations' field in {} is not an array, skipping", inkc_path.display());
            }
        }

        Ok(violations)
    }
}
