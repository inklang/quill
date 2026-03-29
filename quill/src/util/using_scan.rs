/// A parsed "using" declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsingDecl {
    /// The package being used (e.g., "ink.base" or "ink.mobs as mobs")
    pub package: String,
    /// Optional alias if "as X" syntax is used
    pub alias: Option<String>,
}

/// Scan source text for "using" declarations.
///
/// Examples:
/// - `using ink.base;` -> UsingDecl { package: "ink.base", alias: None }
/// - `using ink.mobs as mobs;` -> UsingDecl { package: "ink.mobs", alias: Some("mobs") }
/// - `using "ink.base";` -> UsingDecl { package: "ink.base", alias: None }
pub fn scan_using_declarations(source: &str) -> Vec<UsingDecl> {
    let mut declarations = Vec::new();
    let bytes = source.as_bytes();
    let mut pos = 0;

    while pos < bytes.len() {
        // Skip whitespace
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }

        if pos >= bytes.len() {
            break;
        }

        // Check for "using" keyword
        if bytes[pos] == b'u'
            && pos + 4 < bytes.len()
            && &bytes[pos..pos + 5] == b"using"
            && (pos + 5 >= bytes.len() || !bytes[pos + 5].is_ascii_alphanumeric())
        {
            pos += 5;

            // Skip whitespace after "using"
            while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
                pos += 1;
            }

            // Parse the package name (could be quoted or unquoted)
            let (package, consumed) = if pos < bytes.len() && (bytes[pos] == b'"' || bytes[pos] == b'\'') {
                let quote = bytes[pos];
                pos += 1;
                let start = pos;
                while pos < bytes.len() && bytes[pos] != quote {
                    if bytes[pos] == b'\\' && pos + 1 < bytes.len() {
                        pos += 2; // skip escape
                    } else {
                        pos += 1;
                    }
                }
                let package = String::from_utf8_lossy(&bytes[start..pos]).to_string();
                if pos < bytes.len() {
                    pos += 1; // consume closing quote
                }
                (package, true)
            } else {
                // Unquoted package name
                let start = pos;
                while pos < bytes.len() && !bytes[pos].is_ascii_whitespace() && bytes[pos] != b';' {
                    pos += 1;
                }
                let end = pos;
                if start < end {
                    let s = String::from_utf8_lossy(&bytes[start..end]).to_string();
                    let is_nonempty = !s.is_empty();
                    (s, is_nonempty)
                } else {
                    (String::new(), false)
                }
            };

            if consumed {
                let mut alias = None;

                // Skip whitespace
                while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
                    pos += 1;
                }

                // Check for "as" keyword
                if pos < bytes.len()
                    && bytes[pos] == b'a'
                    && pos + 2 < bytes.len()
                    && &bytes[pos..pos + 2] == b"as"
                    && (pos + 2 >= bytes.len() || !bytes[pos + 2].is_ascii_alphanumeric())
                {
                    pos += 2;

                    // Skip whitespace after "as"
                    while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
                        pos += 1;
                    }

                    // Parse alias
                    let start = pos;
                    while pos < bytes.len() && !bytes[pos].is_ascii_whitespace() && bytes[pos] != b';' {
                        pos += 1;
                    }
                    let alias_str = String::from_utf8_lossy(&bytes[start..pos]).to_string();
                    if !alias_str.is_empty() {
                        alias = Some(alias_str);
                    }
                }

                // Skip whitespace and semicolon
                while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
                    pos += 1;
                }
                if pos < bytes.len() && bytes[pos] == b';' {
                    pos += 1;
                }

                declarations.push(UsingDecl {
                    package,
                    alias,
                });
            }
        } else {
            // Skip to next line or comment
            while pos < bytes.len() && bytes[pos] != b'\n' {
                pos += 1;
            }
            pos += 1;
        }
    }

    declarations
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_simple_using() {
        let source = r#"
            using ink.base;
            using ink.mobs;
        "#;
        let decls = scan_using_declarations(source);
        assert_eq!(decls.len(), 2);
        assert_eq!(decls[0].package, "ink.base");
        assert_eq!(decls[0].alias, None);
        assert_eq!(decls[1].package, "ink.mobs");
    }

    #[test]
    fn test_scan_using_with_alias() {
        let source = r#"
            using ink.mobs as mobs;
        "#;
        let decls = scan_using_declarations(source);
        assert_eq!(decls.len(), 1);
        assert_eq!(decls[0].package, "ink.mobs");
        assert_eq!(decls[0].alias, Some("mobs".to_string()));
    }

    #[test]
    fn test_scan_quoted_using() {
        let source = r#"using "ink.base";"#;
        let decls = scan_using_declarations(source);
        assert_eq!(decls.len(), 1);
        assert_eq!(decls[0].package, "ink.base");
    }

    #[test]
    fn test_scan_no_using() {
        let source = r#"
            grammar test;
            declare spawn {
                rule = keyword "spawn";
            }
        "#;
        let decls = scan_using_declarations(source);
        assert!(decls.is_empty());
    }

    #[test]
    fn test_scan_inline_comment() {
        let source = r#"
            using ink.base; // inline comment
            using ink.mobs;
        "#;
        let decls = scan_using_declarations(source);
        assert_eq!(decls.len(), 2);
    }

    #[test]
    fn test_scan_block_comment() {
        let source = r#"
            /* block comment
               with using inside */
            using ink.base;
        "#;
        let decls = scan_using_declarations(source);
        assert_eq!(decls.len(), 1);
    }
}
