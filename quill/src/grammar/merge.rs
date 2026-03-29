use std::collections::BTreeMap;

use crate::error::{QuillError, Result};

use super::{GrammarIr, KeywordDef};

/// Merge multiple grammars into a single GrammarIr.
///
/// - `base` is the base grammar
/// - `packages` is a list of (alias, grammar) pairs
///
/// If alias is Some, the grammar's keywords are prefixed with "alias::".
/// If alias is None, keywords are used as-is.
///
/// Returns an error if the same keyword is defined in multiple packages without an alias.
pub fn merge_grammars(
    base: &GrammarIr,
    packages: &[(Option<String>, GrammarIr)],
) -> Result<GrammarIr> {
    let mut merged_keywords: BTreeMap<String, KeywordDef> = BTreeMap::new();
    let mut errors = Vec::new();

    // Start with base grammar's keywords
    for (name, keyword) in &base.keywords {
        merged_keywords.insert(name.clone(), keyword.clone());
    }

    // Merge in each package's keywords
    for (maybe_alias, grammar) in packages {
        for (keyword_name, keyword) in &grammar.keywords {
            let final_name = if let Some(alias_str) = maybe_alias {
                format!("{}::{}", alias_str, keyword_name)
            } else {
                // Check for conflict
                if merged_keywords.contains_key(keyword_name) {
                    errors.push(format!(
                        "keyword '{}' is defined in multiple packages without aliases",
                        keyword_name
                    ));
                    continue;
                }
                keyword_name.clone()
            };

            merged_keywords.insert(final_name, keyword.clone());
        }
    }

    if !errors.is_empty() {
        return Err(QuillError::GrammarValidation { errors });
    }

    // Collect all imports
    let mut all_imports = base.imports.clone();
    for (_, grammar) in packages {
        all_imports.extend(grammar.imports.clone());
    }

    Ok(GrammarIr {
        package: base.package.clone(),
        rules: base.rules.clone(),
        keywords: merged_keywords,
        imports: all_imports,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_grammar(package: &str, keywords: Vec<&str>) -> GrammarIr {
        let mut kws = BTreeMap::new();
        for name in keywords {
            kws.insert(
                name.to_string(),
                KeywordDef {
                    name: name.to_string(),
                    inherits: None,
                    rules: BTreeMap::new(),
                },
            );
        }
        GrammarIr {
            package: package.to_string(),
            rules: BTreeMap::new(),
            keywords: kws,
            imports: Vec::new(),
        }
    }

    #[test]
    fn test_merge_empty_packages() {
        let base = make_grammar("base", vec!["kw1"]);
        let result = merge_grammars(&base, &[]).unwrap();
        assert!(result.keywords.contains_key("kw1"));
    }

    #[test]
    fn test_merge_with_alias() {
        let base = make_grammar("base", vec!["kw1"]);
        let pkg = make_grammar("pkg", vec!["kw2"]);

        let result = merge_grammars(&base, &[(Some("alias".to_string()), pkg)]).unwrap();
        assert!(result.keywords.contains_key("kw1"));
        assert!(result.keywords.contains_key("alias::kw2"));
        assert!(!result.keywords.contains_key("kw2"));
    }

    #[test]
    fn test_merge_conflict() {
        let base = make_grammar("base", vec!["kw1"]);
        let pkg1 = make_grammar("pkg1", vec!["kw1"]);
        let pkg2 = make_grammar("pkg2", vec!["kw1"]);

        let result = merge_grammars(
            &base,
            &[
                (None, pkg1),
                (None, pkg2),
            ],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_merge_no_conflict_with_aliases() {
        let base = make_grammar("base", vec![]);
        let pkg1 = make_grammar("pkg1", vec!["kw1"]);
        let pkg2 = make_grammar("pkg2", vec!["kw1"]);

        let result = merge_grammars(
            &base,
            &[
                (Some("a".to_string()), pkg1),
                (Some("b".to_string()), pkg2),
            ],
        );
        assert!(result.is_ok());
        assert!(result.unwrap().keywords.contains_key("a::kw1"));
        assert!(result.unwrap().keywords.contains_key("b::kw1"));
    }
}
