use crate::error::Result;

use super::{GrammarIr, GrammarRule, KeywordDef, Pattern};
use crate::printing_press::inklang::grammar::{DeclarationDef, GrammarPackage, Rule, RuleEntry};
use std::collections::{BTreeMap, HashMap};

/// Serializer for GrammarIr to JSON.
pub struct GrammarSerializer;

impl GrammarSerializer {
    /// Serialize a GrammarIr to a JSON string.
    pub fn serialize(ir: &GrammarIr) -> Result<String> {
        serde_json::to_string_pretty(ir)
            .map_err(|e| crate::error::QuillError::GrammarValidation {
                errors: vec![format!("serialization failed: {}", e)],
            })
    }

    /// Serialize a GrammarIr to a JSON string (compact format).
    pub fn serialize_compact(ir: &GrammarIr) -> Result<String> {
        serde_json::to_string(ir)
            .map_err(|e| crate::error::QuillError::GrammarValidation {
                errors: vec![format!("serialization failed: {}", e)],
            })
    }

    /// Convert a GrammarIr into a GrammarPackage (the JSON format printing_press expects).
    pub fn serialize_grammar_package(ir: &GrammarIr) -> GrammarPackage {
        // Collect all keyword VALUES by extracting Literal strings from KeywordDef.rules patterns.
        // For `keyword direction = "north" | "south"`:
        //   KeywordDef.rules["direction"] has GrammarRule{pattern: Choice([Literal("north"), Literal("south")])}
        let mut keywords: Vec<String> = Vec::new();
        for (_name, kw_def) in &ir.keywords {
            extract_keyword_values(&kw_def.rules, &mut keywords);
        }
        keywords.sort();
        keywords.dedup();

        // Map rules into printing_press Rule enum
        let mut rules: HashMap<String, RuleEntry> = HashMap::new();
        let mut declarations: Vec<DeclarationDef> = Vec::new();

        for (name, rule_def) in &ir.rules {
            let rule = pattern_to_rule(&rule_def.pattern);

            if rule_def.inherits.is_empty() {
                // General parsing rule -> rules HashMap
                rules.insert(name.clone(), RuleEntry {
                    rule,
                    handler: rule_def.handler.clone(),
                });
            } else {
                // Has inheritance -> declaration
                declarations.push(DeclarationDef {
                    keyword: name.clone(),
                    name_rule: rule,
                    scope_rules: vec![],
                    inherits_base: true,
                    handler: rule_def.handler.clone(),
                });
            }
        }

        GrammarPackage {
            version: 1,
            package: ir.package.clone(),
            keywords,
            rules,
            declarations,
        }
    }
}

/// Recursively extract Literal string values from a BTreeMap of GrammarRules.
/// Used to populate the `keywords` field in GrammarPackage.
fn extract_keyword_values(rules: &BTreeMap<String, GrammarRule>, out: &mut Vec<String>) {
    for (_name, rule_def) in rules {
        collect_literals(&rule_def.pattern, out);
    }
}

fn collect_literals(pattern: &Pattern, out: &mut Vec<String>) {
    match pattern {
        Pattern::Literal(s) => out.push(s.clone()),
        Pattern::Choice(items) | Pattern::Sequence(items) => {
            for item in items { collect_literals(item, out); }
        }
        Pattern::Block(items) => {
            for item in items { collect_literals(item, out); }
        }
        Pattern::Optional(item) => {
            collect_literals(item, out);
        }
        Pattern::Repeat(p) | Pattern::Repeat1(p) => collect_literals(p, out),
        _ => {}
    }
}

fn pattern_to_rule(pattern: &Pattern) -> Rule {
    match pattern {
        Pattern::Literal(s) => Rule::Literal { value: s.clone() },
        Pattern::Ident => Rule::Identifier,
        Pattern::Int => Rule::Int,
        Pattern::Float => Rule::Float,
        Pattern::String => Rule::String,
        Pattern::Block(items) => Rule::Seq {
            items: items.iter().map(pattern_to_rule).collect(),
        },
        Pattern::Choice(items) => Rule::Choice {
            items: items.iter().map(pattern_to_rule).collect(),
        },
        Pattern::Sequence(items) => Rule::Seq {
            items: items.iter().map(pattern_to_rule).collect(),
        },
        Pattern::Repeat(p) => Rule::Many {
            item: Box::new(pattern_to_rule(p)),
        },
        Pattern::Repeat1(p) => Rule::Many1 {
            item: Box::new(pattern_to_rule(p)),
        },
        Pattern::Optional(p) => Rule::Optional {
            item: Box::new(pattern_to_rule(p)),
        },
        Pattern::Keyword(value) => Rule::Keyword { value: value.clone() },
        Pattern::Ref(name) => Rule::Ref { rule: name.clone() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use crate::grammar::{GrammarIr, GrammarRule, KeywordDef, Pattern};
    use crate::printing_press::inklang::grammar::{DeclarationDef, GrammarPackage, Rule, RuleEntry};

    #[test]
    fn test_serialize_grammar_ir() {
        let ir = GrammarIr {
            package: "test".to_string(),
            rules: BTreeMap::new(),
            keywords: BTreeMap::new(),
            imports: vec!["ink.base".to_string()],
        };

        let json = GrammarSerializer::serialize(&ir).unwrap();
        assert!(json.contains("test"));
        assert!(json.contains("ink.base"));
    }

    #[test]
    fn test_serialize_compact() {
        let ir = GrammarIr {
            package: "test".to_string(),
            rules: BTreeMap::new(),
            keywords: BTreeMap::new(),
            imports: Vec::new(),
        };

        let json = GrammarSerializer::serialize_compact(&ir).unwrap();
        assert!(!json.contains("\n"));
    }

    #[test]
    fn test_serialize_keyword_decl() {
        let mut keywords = BTreeMap::new();
        // keyword direction = "north" | "south" | "east" | "west";
        let kw_rule = GrammarRule {
            name: "direction".to_string(),
            pattern: Pattern::Choice(vec![
                Pattern::Literal("north".to_string()),
                Pattern::Literal("south".to_string()),
                Pattern::Literal("east".to_string()),
                Pattern::Literal("west".to_string()),
            ]),
            handler: None,
            inherits: vec![],
        };
        let mut rules = BTreeMap::new();
        rules.insert("direction".to_string(), kw_rule);
        keywords.insert("direction".to_string(), KeywordDef {
            name: "direction".to_string(),
            inherits: None,
            rules,
        });

        let ir = GrammarIr {
            package: "mygame".to_string(),
            rules: BTreeMap::new(),
            keywords,
            imports: vec!["base".to_string()],
        };

        let pkg = GrammarSerializer::serialize_grammar_package(&ir);
        assert_eq!(pkg.version, 1);
        assert_eq!(pkg.package, "mygame");
        // Keywords should be the actual VALUES, not just names
        assert!(pkg.keywords.contains(&"north".to_string()));
        assert!(pkg.keywords.contains(&"south".to_string()));
        assert!(pkg.keywords.contains(&"east".to_string()));
        assert!(pkg.keywords.contains(&"west".to_string()));
    }

    #[test]
    fn test_serialize_rule_to_rule_entry() {
        let mut rules = BTreeMap::new();
        rules.insert("player_move".to_string(), GrammarRule {
            name: "player_move".to_string(),
            pattern: Pattern::Sequence(vec![
                Pattern::Literal("move".to_string()),
                Pattern::Ident,
                Pattern::Int,
                Pattern::Int,
            ]),
            handler: Some("handleMove".to_string()),
            inherits: vec![],
        });

        let ir = GrammarIr {
            package: "mygame".to_string(),
            rules,
            keywords: BTreeMap::new(),
            imports: vec![],
        };

        let pkg = GrammarSerializer::serialize_grammar_package(&ir);
        let entry = pkg.rules.get("player_move").unwrap();
        assert!(matches!(entry.rule, Rule::Seq { .. }));
        assert_eq!(entry.handler, Some("handleMove".to_string()));
    }

    #[test]
    fn test_serialize_rule_with_inherits_to_declaration() {
        let mut rules = BTreeMap::new();
        rules.insert("on_click".to_string(), GrammarRule {
            name: "on_click".to_string(),
            pattern: Pattern::Sequence(vec![
                Pattern::Literal("click".to_string()),
                Pattern::Ident,
            ]),
            handler: Some("handleClick".to_string()),
            inherits: vec!["on_event".to_string()],
        });

        let ir = GrammarIr {
            package: "mygame".to_string(),
            rules,
            keywords: BTreeMap::new(),
            imports: vec![],
        };

        let pkg = GrammarSerializer::serialize_grammar_package(&ir);
        assert!(pkg.declarations.iter().any(|d| d.keyword == "on_click"));
    }
}
