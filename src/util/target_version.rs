use crate::manifest::{BuildConfig, PackageManifest, ServerConfig};
use crate::util::semver::SemverRange;

/// Version issue found during compatibility checking.
#[derive(Debug, Clone)]
pub struct VersionIssue {
    pub package: String,
    pub message: String,
}

/// Resolve the target version based on priority:
/// 1. CLI flag (explicit)
/// 2. build.target-version
/// 3. server.<target>.target-version
pub fn resolve_target_version(
    cli_flag: Option<&str>,
    build_config: Option<&BuildConfig>,
    server_config: Option<&ServerConfig>,
    target: &str,
) -> Option<SemverRange> {
    // 1. CLI flag has highest priority
    if let Some(flag) = cli_flag {
        if let Ok(range) = SemverRange::parse(flag) {
            return Some(range);
        }
    }

    // 2. build.target-version
    if let Some(build) = build_config {
        if let Some(ref version) = build.target_version {
            if let Ok(range) = SemverRange::parse(version) {
                return Some(range);
            }
        }
    }

    // 3. server.<target>.target-version
    if let Some(_server) = server_config {
        // For now, paper target config is just a string URL
        // This would need to be parsed as TargetConfig in a full implementation
        // server.paper contains the target-specific configuration
    }

    let _ = target; // target is used when server config is available
    None
}

/// Check if a package and its dependencies are compatible with the target version.
pub fn check_target_version_compatibility(
    manifest: &PackageManifest,
    dep_manifests: &[&PackageManifest],
    target: &str,
    target_version: &SemverRange,
) -> Vec<VersionIssue> {
    let mut issues = Vec::new();

    // Check the main manifest
    check_manifest_compatibility(manifest, target, target_version, &mut issues);

    // Check dependencies
    for dep in dep_manifests {
        check_manifest_compatibility(dep, target, target_version, &mut issues);
    }

    issues
}

fn check_manifest_compatibility(
    manifest: &PackageManifest,
    target: &str,
    target_version: &SemverRange,
    issues: &mut Vec<VersionIssue>,
) {
    // Check if the package has target-specific constraints
    if let Some(targets) = manifest.targets.get(target) {
        if let Some(ref target_ver) = targets.target_version {
            if let Ok(range) = SemverRange::parse(target_ver) {
                if !version_ranges_compatible(&range, target_version) {
                    issues.push(VersionIssue {
                        package: manifest.package.name.clone(),
                        message: format!(
                            "package requires {} for target '{}', but build uses {:?}",
                            target_ver, target, target_version
                        ),
                    });
                }
            }
        }
    }

    // Check dependencies for target-specific constraints
    for (_dep_name, _dep_range) in &manifest.dependencies {
        // In a full implementation, we would look up dep_manifests to check
        // if the dependency has target-specific requirements
    }
}

/// Check if two version ranges are compatible.
/// Returns true if there's no conflict.
fn version_ranges_compatible(required: &SemverRange, available: &SemverRange) -> bool {
    // For simplicity, we just check if the available range could satisfy the required range
    // In practice, this would need more sophisticated semver comparison
    match (required, available) {
        (SemverRange::Exact(req), SemverRange::Exact(avail)) => req == avail,
        _ => true, // For non-exact ranges, we assume compatibility
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_target_version_cli_first() {
        let build = BuildConfig {
            entry: None,
            compiler: None,
            target: None,
            target_version: Some("^1.0.0".to_string()),
        };

        let result = resolve_target_version(Some("^2.0.0"), Some(&build), None, "paper");
        assert!(result.is_some());
        let range = result.unwrap();
        // CLI flag should win
        match range {
            SemverRange::Caret(s) => assert_eq!(s.major, 2),
            _ => panic!("expected caret range"),
        }
    }

    #[test]
    fn test_resolve_target_version_build_fallback() {
        let build = BuildConfig {
            entry: None,
            compiler: None,
            target: None,
            target_version: Some("^1.0.0".to_string()),
        };

        let result = resolve_target_version(None, Some(&build), None, "paper");
        assert!(result.is_some());
        let range = result.unwrap();
        match range {
            SemverRange::Caret(s) => assert_eq!(s.major, 1),
            _ => panic!("expected caret range"),
        }
    }

    #[test]
    fn test_resolve_target_version_none() {
        let result = resolve_target_version(None, None, None, "paper");
        assert!(result.is_none());
    }
}
