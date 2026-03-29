use std::collections::BTreeMap;
use std::collections::HashSet;

use crate::error::{QuillError, Result};
use crate::registry::index::RegistryIndex;
use crate::util::semver::{Semver, SemverRange};

/// A resolved package with its resolved version and metadata.
#[derive(Debug, Clone)]
pub struct ResolvedPackage {
    pub name: String,
    pub version: String,
    pub url: String,
    pub range: String,
    pub targets: Option<Vec<String>>,
    pub checksum: Option<String>,
    pub dep_keys: Vec<String>,
}

/// Resolve transitive dependencies starting from root packages.
///
/// # Arguments
///
/// * `index` - The registry index to use for looking up packages
/// * `roots` - Map of package names to version ranges (e.g., {"foo": "^1.0.0"})
///
/// # Returns
///
/// A map of package names to resolved packages with full metadata.
///
/// # Errors
///
/// Returns an error if:
/// - A package is not found in the registry
/// - A circular dependency is detected
/// - Multiple parents require incompatible version ranges
pub fn resolve_transitive(
    index: &RegistryIndex,
    roots: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, ResolvedPackage>> {
    let mut resolved: BTreeMap<String, ResolvedPackage> = BTreeMap::new();
    let mut visiting: HashSet<String> = HashSet::new();
    let mut range_constraints: BTreeMap<String, Vec<String>> = BTreeMap::new();

    // First pass: collect all constraints from roots
    for (name, range) in roots {
        range_constraints
            .entry(name.clone())
            .or_default()
            .push(range.clone());
    }

    // Resolve each root recursively
    for (name, range) in roots {
        resolve_package(
            index,
            name,
            range,
            &mut resolved,
            &mut visiting,
            &mut range_constraints,
        )?;
    }

    Ok(resolved)
}

fn resolve_package(
    index: &RegistryIndex,
    name: &str,
    range: &str,
    resolved: &mut BTreeMap<String, ResolvedPackage>,
    visiting: &mut HashSet<String>,
    range_constraints: &mut BTreeMap<String, Vec<String>>,
) -> Result<()> {
    // Check for circular dependencies
    if visiting.contains(name) {
        return Err(QuillError::CircularDependency {
            chain: vec![name.to_string()],
        });
    }

    // If already resolved with a compatible range, check if we're adding new constraints
    if let Some(existing) = resolved.get(name) {
        // Check if the existing version satisfies the new range
        let new_range = SemverRange::parse(range)
            .map_err(|e| QuillError::RegistryAuth { message: e })?;
        let existing_ver: Semver = existing.version.parse().map_err(|e| {
            QuillError::RegistryAuth {
                message: format!("invalid version: {}", e),
            }
        })?;

        if new_range.matches(&existing_ver) {
            // Already resolved with a compatible version
            return Ok(());
        }

        // Ranges are incompatible - check if we can upgrade to satisfy both
        // Collect all constraints for this package
        let all_ranges: Vec<&str> = range_constraints
            .get(name)
            .map(|v| v.iter().map(|s| s.as_str()).collect())
            .unwrap_or_default();

        // Try to find a version that satisfies all constraints
        if let Some((version_str, pkg)) = index.find_best_match(name, range) {
            // Check if this version satisfies ALL constraints
            let ver: Semver = version_str.parse().map_err(|e| QuillError::RegistryAuth {
                message: format!("invalid version: {}", e),
            })?;

            let all_satisfied = all_ranges.iter().all(|r| {
                if let Ok(rng) = SemverRange::parse(r) {
                    rng.matches(&ver)
                } else {
                    false
                }
            });

            if all_satisfied {
                // We found a better match that satisfies all constraints
                let dep_keys: Vec<String> = pkg
                    .dependencies
                    .keys()
                    .cloned()
                    .collect();

                resolved.insert(
                    name.to_string(),
                    ResolvedPackage {
                        name: name.to_string(),
                        version: version_str.to_string(),
                        url: pkg.url.clone(),
                        range: range.to_string(),
                        targets: pkg.targets.clone(),
                        checksum: pkg.checksum.clone(),
                        dep_keys,
                    },
                );
                return Ok(());
            }
        }

        // Conflict detected - all ranges for this package
        return Err(QuillError::ResolutionConflict {
            package: name.to_string(),
            ranges: range_constraints
                .get(name)
                .cloned()
                .unwrap_or_default(),
        });
    }

    // Mark as visiting (in current resolution path)
    visiting.insert(name.to_string());

    // Find the best matching version
    let (version_str, pkg) = index
        .find_best_match(name, range)
        .ok_or_else(|| QuillError::PackageNotFound {
            name: name.to_string(),
            version: Some(range.to_string()),
        })?;

    // Add dependencies to constraints
    for (dep_name, dep_range) in &pkg.dependencies {
        range_constraints
            .entry(dep_name.clone())
            .or_default()
            .push(dep_range.clone());
    }

    // Recursively resolve dependencies
    for (dep_name, dep_range) in &pkg.dependencies {
        resolve_package(
            index,
            dep_name,
            dep_range,
            resolved,
            visiting,
            range_constraints,
        )?;
    }

    // Remove from visiting set
    visiting.remove(name);

    // Add to resolved
    let dep_keys: Vec<String> = pkg.dependencies.keys().cloned().collect();

    resolved.insert(
        name.to_string(),
        ResolvedPackage {
            name: name.to_string(),
            version: version_str.to_string(),
            url: pkg.url.clone(),
            range: range.to_string(),
            targets: pkg.targets.clone(),
            checksum: pkg.checksum.clone(),
            dep_keys,
        },
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolved_package_structure() {
        let pkg = ResolvedPackage {
            name: "test".to_string(),
            version: "1.0.0".to_string(),
            url: "https://example.com/test".to_string(),
            range: "^1.0.0".to_string(),
            targets: Some(vec!["paper".to_string()]),
            checksum: Some("abc123".to_string()),
            dep_keys: vec!["dep1".to_string()],
        };

        assert_eq!(pkg.name, "test");
        assert_eq!(pkg.version, "1.0.0");
    }
}
