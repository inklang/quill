use async_trait::async_trait;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};

pub struct Audit {
    pub fix: bool,
    pub severities: Vec<String>,
    pub no_ignore: bool,
}

/// Bytecode scanner to detect potentially unsafe operations.
struct BytecodeScanner;

impl BytecodeScanner {
    /// Scan an .inkc file for potentially unsafe operations.
    fn scan_file(path: &Path) -> Result<Vec<String>> {
        let content = fs::read_to_string(path)
            .map_err(|e| QuillError::io_error("failed to read bytecode file", e))?;

        // Parse the JSON bytecode
        let bytecode: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| QuillError::RegistryAuth {
                message: format!("failed to parse bytecode JSON: {}", e),
            })?;

        let mut unsafe_ops = Vec::new();

        // Check for dangerous operations in the bytecode
        if let Some(ops) = bytecode.get("operations").and_then(|o| o.as_array()) {
            for op in ops {
                if let Some(name) = op.get("name").and_then(|n| n.as_str()) {
                    // Check for unsafe operations
                    if is_unsafe_operation(name) {
                        unsafe_ops.push(name.to_string());
                    }
                }
            }
        }

        Ok(unsafe_ops)
    }
}

/// Check if an operation is considered unsafe.
fn is_unsafe_operation(op: &str) -> bool {
    matches!(op,
        "exec" |
        "eval" |
        "system" |
        "runtime.exec" |
        "process.exit"
    )
}

#[async_trait]
impl Command for Audit {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        println!("Auditing bytecode for vulnerabilities...");

        // Find all .inkc files in the project
        let target_dir = ctx.project_dir.join("target").join("ink");
        let mut inkc_files = Vec::new();

        if target_dir.exists() {
            find_inkc_files(&target_dir, &mut inkc_files)?;
        } else {
            // Look in src as well
            let src_dir = ctx.project_dir.join("src");
            if src_dir.exists() {
                find_inkc_files(&src_dir, &mut inkc_files)?;
            }
        }

        if inkc_files.is_empty() {
            println!("No compiled bytecode found. Run 'quill build' first.");
            return Ok(());
        }

        // Scan each file
        let mut issues = Vec::new();
        for file in &inkc_files {
            if let Ok(unsafe_ops) = BytecodeScanner::scan_file(file) {
                if !unsafe_ops.is_empty() {
                    issues.push((file.clone(), unsafe_ops));
                }
            }
        }

        if issues.is_empty() {
            println!("No vulnerabilities found in {} bytecode files", inkc_files.len());
            return Ok(());
        }

        // Report issues
        println!("Found potential issues in {} files:", issues.len());
        for (file, ops) in &issues {
            println!("\n{}:", file.display());
            for op in ops {
                println!("  - Potentially unsafe operation: {}", op);
            }
        }

        // Query OSV.dev in a full implementation
        // For now, just report what we found

        if !issues.is_empty() {
            return Err(QuillError::VulnerabilitiesFound { count: issues.len() });
        }

        Ok(())
    }
}

fn find_inkc_files(dir: &Path, results: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(dir)
        .map_err(|e| QuillError::io_error(&format!("failed to read dir {}", dir.display()), e))?
    {
        let entry = entry
            .map_err(|e| QuillError::io_error("failed to read dir entry", e))?;
        let path = entry.path();

        if path.is_dir() {
            find_inkc_files(&path, results)?;
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext == "inkc" {
                results.push(path);
            }
        }
    }
    Ok(())
}
