use async_trait::async_trait;
use std::path::{Path, PathBuf};

use crate::audit::{BytecodeScanner, OsvClient, Severity};
use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};

pub struct Audit {
    pub fix: bool,
    pub severities: Vec<String>,
    pub no_ignore: bool,
}

#[async_trait]
impl Command for Audit {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        println!("Auditing project for vulnerabilities...");

        let mut issues = Vec::new();

        // Scan bytecode files
        let bytecode_issues = scan_bytecode(ctx).await?;
        issues.extend(bytecode_issues);

        // Scan dependencies via OSV
        let osv_issues = scan_dependencies(ctx).await?;
        issues.extend(osv_issues);

        if issues.is_empty() {
            println!("No vulnerabilities found.");
            return Ok(());
        }

        // Report issues
        println!("\nFound {} vulnerability(ies):", issues.len());
        for issue in &issues {
            println!("\n[{}] {}", issue.severity, issue.id);
            println!("  Summary: {}", issue.summary);
            if !issue.references.is_empty() {
                println!("  References:");
                for r in &issue.references {
                    println!("    - {}", r);
                }
            }
        }

        Err(QuillError::VulnerabilitiesFound { count: issues.len() })
    }
}

struct VulnerabilityIssue {
    id: String,
    severity: String,
    summary: String,
    references: Vec<String>,
}

async fn scan_bytecode(ctx: &Context) -> Result<Vec<VulnerabilityIssue>> {
    let target_dir = ctx.project_dir.join("target").join("ink");
    let mut inkc_files = Vec::new();

    if target_dir.exists() {
        find_inkc_files(&target_dir, &mut inkc_files)?;
    } else {
        let src_dir = ctx.project_dir.join("src");
        if src_dir.exists() {
            find_inkc_files(&src_dir, &mut inkc_files)?;
        }
    }

    let mut issues = Vec::new();

    for file in &inkc_files {
        match BytecodeScanner::scan(file) {
            Ok(violations) => {
                for v in violations {
                    issues.push(VulnerabilityIssue {
                        id: format!("BYTE-001: {} in {}", v.operation, file.display()),
                        severity: "High".to_string(),
                        summary: format!(
                            "Disallowed operation '{}' found at {}",
                            v.operation, v.location
                        ),
                        references: vec![],
                    });
                }
            }
            Err(e) => {
                eprintln!("Warning: failed to scan {}: {}", file.display(), e);
            }
        }
    }

    Ok(issues)
}

async fn scan_dependencies(ctx: &Context) -> Result<Vec<VulnerabilityIssue>> {
    let lockfile = match &ctx.lockfile {
        Some(lf) => lf,
        None => return Ok(Vec::new()),
    };

    let client = OsvClient::new();
    let mut issues = Vec::new();

    for (name, package) in &lockfile.packages {
        match client.scan(name, &package.version).await {
            Ok(vulns) => {
                for vuln in vulns {
                    let severity_str = match vuln.severity {
                        Some(Severity::Critical) => "Critical",
                        Some(Severity::High) => "High",
                        Some(Severity::Medium) => "Medium",
                        Some(Severity::Low) => "Low",
                        None => "Unknown",
                    };

                    issues.push(VulnerabilityIssue {
                        id: vuln.id,
                        severity: severity_str.to_string(),
                        summary: vuln.summary,
                        references: vuln.references,
                    });
                }
            }
            Err(e) => {
                eprintln!("Warning: failed to query OSV for {}: {}", name, e);
            }
        }
    }

    Ok(issues)
}

fn find_inkc_files(dir: &Path, results: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(dir)
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
