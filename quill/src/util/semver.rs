use std::fmt;
use std::str::FromStr;

/// A semantic version with major, minor, and patch components.
#[derive(Debug, Clone, Copy, Ord, PartialOrd, Eq, PartialEq)]
pub struct Semver {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl fmt::Display for Semver {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

impl FromStr for Semver {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let parts: Vec<&str> = s.split('.').collect();
        if parts.len() < 2 || parts.len() > 3 {
            return Err(format!("invalid semver format: {}", s));
        }

        let major = parts[0]
            .parse()
            .map_err(|_| format!("invalid major version: {}", parts[0]))?;
        let minor = parts[1]
            .parse()
            .map_err(|_| format!("invalid minor version: {}", parts[1]))?;
        let patch = if parts.len() == 3 {
            parts[2]
                .parse()
                .map_err(|_| format!("invalid patch version: {}", parts[2]))?
        } else {
            0
        };

        Ok(Semver {
            major,
            minor,
            patch,
        })
    }
}

/// A semantic version range specification.
#[derive(Debug, Clone, PartialEq)]
pub enum SemverRange {
    /// Matches all versions (e.g., "*")
    Any,
    /// Exact version match (e.g., "1.2.3")
    Exact(Semver),
    /// Caret range: >= version < 2.0.0 for major > 0, else < 1.0.0 (e.g., "^1.2.3")
    Caret(Semver),
    /// Tilde range: >= version < (major + 1).0.0 if minor == 0, else < major.(minor + 1).0 (e.g., "~1.2.3")
    Tilde(Semver),
    /// Greater than or equal range (e.g., ">=1.2.3")
    Gte(Semver),
    /// Less than range (e.g., "<2.0.0")
    Lt(Semver),
    /// Compound range combining multiple constraints (e.g., ">=1.20 <1.23")
    Compound(Vec<SemverRange>),
}

impl SemverRange {
    /// Parse a string into a SemverRange.
    pub fn parse(input: &str) -> Result<Self, String> {
        let input = input.trim();

        // Handle wildcard
        if input == "*" {
            return Ok(SemverRange::Any);
        }

        // Handle compound ranges (space-separated)
        if input.contains(' ') {
            let parts: Result<Vec<_>, _> = input
                .split_whitespace()
                .map(SemverRange::parse)
                .collect();
            return Ok(SemverRange::Compound(parts?));
        }

        // Handle prefix operators
        if let Some(version_str) = input.strip_prefix("^") {
            let semver: Semver = version_str.parse()?;
            return Ok(SemverRange::Caret(semver));
        }

        if let Some(version_str) = input.strip_prefix("~") {
            let semver: Semver = version_str.parse()?;
            return Ok(SemverRange::Tilde(semver));
        }

        if let Some(version_str) = input.strip_prefix(">=") {
            let semver: Semver = version_str.trim().parse()?;
            return Ok(SemverRange::Gte(semver));
        }

        if let Some(version_str) = input.strip_prefix('<') {
            let semver: Semver = version_str.trim().parse()?;
            return Ok(SemverRange::Lt(semver));
        }

        if let Some(version_str) = input.strip_prefix('=') {
            let semver: Semver = version_str.trim().parse()?;
            return Ok(SemverRange::Exact(semver));
        }

        // Try parsing as exact semver
        if let Ok(semver) = input.parse::<Semver>() {
            return Ok(SemverRange::Exact(semver));
        }

        Err(format!("invalid semver range: {}", input))
    }

    /// Check if this range matches the given version.
    pub fn matches(&self, version: &Semver) -> bool {
        match self {
            SemverRange::Any => true,

            SemverRange::Exact(expected) => *version == *expected,

            SemverRange::Caret(base) => {
                if base.major == 0 {
                    // ^0.x.y: upper bound is 0.(x+1).0 (caret never reaches 1.0.0)
                    let upper = if base.minor == 0 {
                        Semver { major: 0, minor: 1, patch: 0 }
                    } else {
                        Semver { major: 0, minor: base.minor + 1, patch: 0 }
                    };
                    *version >= *base && *version < upper
                } else {
                    // ^x.y.z == >=x.y.z <(x+1).0.0
                    let upper = Semver { major: base.major + 1, minor: 0, patch: 0 };
                    *version >= *base && *version < upper
                }
            }

            SemverRange::Tilde(base) => {
                if base.minor == 0 {
                    // ~x.0.0 == >=x.0.0 <(x+1).0.0
                    version.major == base.major
                        && version.minor == 0
                        && version.patch >= base.patch
                } else {
                    // ~x.y.z == >=x.y.z <x.(y+1).0
                    version.major == base.major
                        && version.minor == base.minor
                        && version.patch >= base.patch
                        && version.minor < base.minor + 1
                }
            }

            SemverRange::Gte(base) => *version >= *base,

            SemverRange::Lt(limit) => *version < *limit,

            SemverRange::Compound(ranges) => {
                ranges.iter().all(|range| range.matches(version))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_semver_parse() {
        let v: Semver = "1.2.3".parse().unwrap();
        assert_eq!(v.major, 1);
        assert_eq!(v.minor, 2);
        assert_eq!(v.patch, 3);
    }

    #[test]
    fn test_semver_display() {
        let v = Semver {
            major: 1,
            minor: 2,
            patch: 3,
        };
        assert_eq!(format!("{}", v), "1.2.3");
    }

    #[test]
    fn test_semver_range_any() {
        let range = SemverRange::parse("*").unwrap();
        let v: Semver = "1.0.0".parse().unwrap();
        assert!(range.matches(&v));
    }

    #[test]
    fn test_semver_range_exact() {
        let range = SemverRange::parse("1.2.3").unwrap();
        assert!(range.matches(&"1.2.3".parse().unwrap()));
        assert!(!range.matches(&"1.2.4".parse().unwrap()));
    }

    #[test]
    fn test_semver_range_caret() {
        // ^1.2.3 should match >=1.2.3 <2.0.0
        let range = SemverRange::parse("^1.2.3").unwrap();
        assert!(range.matches(&"1.2.3".parse().unwrap()));
        assert!(range.matches(&"1.3.0".parse().unwrap()));
        assert!(range.matches(&"1.9.9".parse().unwrap()));
        assert!(!range.matches(&"2.0.0".parse().unwrap()));
        assert!(!range.matches(&"0.9.9".parse().unwrap()));
    }

    #[test]
    fn test_semver_range_caret_zero_major() {
        // ^0.2.3 should match >=0.2.3 <0.3.0
        let range = SemverRange::parse("^0.2.3").unwrap();
        assert!(range.matches(&"0.2.3".parse().unwrap()));
        assert!(range.matches(&"0.2.4".parse().unwrap()));
        assert!(!range.matches(&"0.3.0".parse().unwrap()));
        assert!(!range.matches(&"1.0.0".parse().unwrap()));
    }

    #[test]
    fn test_semver_range_tilde() {
        // ~1.2.3 should match >=1.2.3 <1.3.0
        let range = SemverRange::parse("~1.2.3").unwrap();
        assert!(range.matches(&"1.2.3".parse().unwrap()));
        assert!(range.matches(&"1.2.4".parse().unwrap()));
        assert!(!range.matches(&"1.3.0".parse().unwrap()));
        assert!(!range.matches(&"2.0.0".parse().unwrap()));
    }

    #[test]
    fn test_semver_range_gte() {
        let range = SemverRange::parse(">=1.2.0").unwrap();
        assert!(range.matches(&"1.2.0".parse().unwrap()));
        assert!(range.matches(&"1.3.0".parse().unwrap()));
        assert!(!range.matches(&"1.1.0".parse().unwrap()));
    }

    #[test]
    fn test_semver_range_lt() {
        let range = SemverRange::parse("<2.0.0").unwrap();
        assert!(range.matches(&"1.9.9".parse().unwrap()));
        assert!(!range.matches(&"2.0.0".parse().unwrap()));
    }

    #[test]
    fn test_semver_range_compound() {
        // >=1.20 <1.23
        let range = SemverRange::parse(">=1.20 <1.23").unwrap();
        assert!(range.matches(&"1.20.0".parse().unwrap()));
        assert!(range.matches(&"1.22.0".parse().unwrap()));
        assert!(!range.matches(&"1.23.0".parse().unwrap()));
        assert!(!range.matches(&"1.19.0".parse().unwrap()));
    }
}
