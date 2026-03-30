use async_trait::async_trait;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};

use crate::audit::{BytecodeScanner, OsvClient, Severity};
use crate::commands::Command;
use crate::context::Context;
use crate::error::{QuillError, Result};

pub struct Audit;

#[async_trait]
impl Command for Audit {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let is_tty = std::io::stdout().is_terminal();

        let mut issues = Vec::new();

        println!("  Scanning bytecode...");

        // Scan bytecode files
        let bytecode_issues = scan_bytecode(ctx).await?;
        issues.extend(bytecode_issues);

        // Scan dependencies via OSV
        let pkg_count = ctx.lockfile.as_ref().map(|lf| lf.packages.len()).unwrap_or(0);
        println!("  Scanning dependencies ({} packages)...", pkg_count);

        let osv_issues = scan_dependencies(ctx).await?;
        issues.extend(osv_issues);

        if issues.is_empty() {
            println!("  \u{2713} No vulnerabilities found");
            return Ok(());
        }

        // Report issues
        println!("\n  Found {} vulnerability(ies):\n", issues.len());
        for issue in &issues {
            print!("  ");
            print_severity_badge(&issue.severity, is_tty);
            println!(" {}", issue.id);
            if let Some(pkg) = &issue.package {
                println!("    {}", pkg);
            }
            println!("    {}", issue.summary);
            for r in &issue.references {
                println!("    {}", r);
            }
            println!();
        }

        Err(QuillError::VulnerabilitiesFound { count: issues.len() })
    }
}

struct VulnerabilityIssue {
    id: String,
    severity: String,
    summary: String,
    references: Vec<String>,
    package: Option<String>,
}

fn print_severity_badge(severity: &str, is_tty: bool) {
    if !is_tty {
        print!("[{}]", severity.to_uppercase());
        return;
    }
    use crossterm::execute;
    use crossterm::style::{Attribute, Color, Print, ResetColor, SetAttribute, SetForegroundColor};
    let color = match severity {
        "Critical" => Color::Red,
        "High" => Color::Red,
        "Medium" => Color::Yellow,
        "Low" => Color::Blue,
        _ => Color::DarkGrey,
    };
    let bold = severity == "Critical";
    let mut stdout = std::io::stdout();
    if bold {
        execute!(stdout, SetAttribute(Attribute::Bold)).unwrap_or(());
    }
    execute!(
        stdout,
        SetForegroundColor(color),
        Print(format!("[{}]", severity.to_uppercase())),
        ResetColor,
    )
    .unwrap_or(());
    if bold {
        execute!(stdout, SetAttribute(Attribute::Reset)).unwrap_or(());
    }
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
                        package: None,
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
                        package: Some(name.clone()),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_print_severity_badge_non_tty() {
        // Non-TTY path is pure formatting — verify it doesn't panic
        // and that the badge text is correct by capturing via a wrapper approach.
        // Since print_severity_badge writes to stdout, we just call it and confirm no panic.
        print_severity_badge("Critical", false);
        print_severity_badge("High", false);
        print_severity_badge("Medium", false);
        print_severity_badge("Low", false);
        print_severity_badge("Unknown", false);
    }

    #[test]
    fn test_vulnerability_issue_has_package_field() {
        let issue = VulnerabilityIssue {
            id: "CVE-2024-1234".to_string(),
            severity: "High".to_string(),
            summary: "test".to_string(),
            references: vec![],
            package: Some("my-pkg".to_string()),
        };
        assert_eq!(issue.package, Some("my-pkg".to_string()));
    }
}
