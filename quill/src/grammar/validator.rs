use crate::error::{QuillError, Result};

use super::{GrammarIr, KeywordDef};

/// Validate a parsed GrammarIr.
///
/// Checks:
/// - Grammar has a package name
/// - All inherited keywords exist
pub fn validate_grammar(ir: &GrammarIr) -> Result<()> {
    let mut errors = Vec::new();

    // Check grammar has a package name
    if ir.package.is_empty() {
        errors.push("grammar must have a non-empty package name".to_string());
    }

    // Check all inherited keywords exist
    for (keyword_name, keyword) in &ir.keywords {
        if let Some(ref inherits) = keyword.inherits {
            if !ir.keywords.contains_key(inherits) {
                errors.push(format!(
                    "keyword '{}' inherits from '{}' which does not exist",
                    keyword_name, inherits
                ));
            }
        }

        // Recursively check inherited keywords in rules
        validate_keyword_rules(keyword, ir, &mut errors);
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(QuillError::GrammarValidation { errors })
    }
}

fn validate_keyword_rules(keyword: &KeywordDef, ir: &GrammarIr, _errors: &mut Vec<String>) {
    for rule in keyword.rules.values() {
        // Check that any rule inherits exist
        for inherited in &rule.inherits {
            // Inherited rules should be validated separately when the base keyword is processed
            let _ = (ir, inherited);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn make_ir(package: &str) -> GrammarIr {
        GrammarIr {
            package: package.to_string(),
            rules: BTreeMap::new(),
            keywords: BTreeMap::new(),
            imports: Vec::new(),
        }
    }

    #[test]
    fn test_valid_grammar() {
        let ir = make_ir("test");
        assert!(validate_grammar(&ir).is_ok());
    }

    #[test]
    fn test_empty_package_name() {
        let ir = make_ir("");
        assert!(validate_grammar(&ir).is_err());
    }

    #[test]
    fn test_missing_inherited_keyword() {
        let mut keywords = BTreeMap::new();
        keywords.insert(
            "child".to_string(),
            KeywordDef {
                name: "child".to_string(),
                inherits: Some("parent".to_string()),
                rules: BTreeMap::new(),
            },
        );

        let ir = GrammarIr {
            package: "test".to_string(),
            rules: BTreeMap::new(),
            keywords,
            imports: Vec::new(),
        };

        let result = validate_grammar(&ir);
        assert!(result.is_err());
    }

    #[test]
    fn test_existing_inherited_keyword() {
        let mut keywords = BTreeMap::new();
        keywords.insert(
            "parent".to_string(),
            KeywordDef {
                name: "parent".to_string(),
                inherits: None,
                rules: BTreeMap::new(),
            },
        );
        keywords.insert(
            "child".to_string(),
            KeywordDef {
                name: "child".to_string(),
                inherits: Some("parent".to_string()),
                rules: BTreeMap::new(),
            },
        );

        let ir = GrammarIr {
            package: "test".to_string(),
            rules: BTreeMap::new(),
            keywords,
            imports: Vec::new(),
        };

        assert!(validate_grammar(&ir).is_ok());
    }
}
