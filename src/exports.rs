use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The version of the exports.json format.
pub const EXPORTS_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PackageExports {
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default)]
    pub classes: BTreeMap<String, ClassExport>,
    #[serde(default)]
    pub functions: BTreeMap<String, Visibility>,
    #[serde(default)]
    pub grammars: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClassExport {
    pub visibility: Visibility,
    #[serde(default)]
    pub methods: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub internal_methods: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    Public,
    Internal,
}

impl Visibility {
    pub fn is_internal(&self) -> bool {
        matches!(self, Visibility::Internal)
    }
}

impl Default for Visibility {
    fn default() -> Self {
        Visibility::Public
    }
}

use crate::printing_press::inklang::ast::{Expr, Stmt};

/// Check if a list of annotations contains `@internal`.
fn has_internal_annotation(annotations: &[Expr]) -> bool {
    annotations.iter().any(|expr| {
        matches!(expr, Expr::Annotation { name, .. } if name == "internal")
    })
}

/// Collect all top-level classes and functions from a list of statements.
/// Returns a `PackageExports` with public/internal visibility determined by
/// `@internal` annotations.
pub fn collect_exports(
    stmts: &[Stmt],
    grammar_packages: &[String],
    author: Option<String>,
) -> PackageExports {
    let mut classes = BTreeMap::new();
    let mut functions = BTreeMap::new();

    for stmt in stmts {
        match stmt {
            Stmt::Class {
                annotations,
                name,
                body,
                ..
            } => {
                let class_internal = has_internal_annotation(annotations);
                let visibility = if class_internal {
                    Visibility::Internal
                } else {
                    Visibility::Public
                };

                let mut methods = Vec::new();
                let mut internal_methods = Vec::new();

                collect_class_methods(body, class_internal, &mut methods, &mut internal_methods);

                classes.insert(
                    name.lexeme.clone(),
                    ClassExport {
                        visibility,
                        methods,
                        internal_methods,
                    },
                );
            }
            Stmt::Fn {
                annotations,
                name,
                ..
            } => {
                let visibility = if has_internal_annotation(annotations) {
                    Visibility::Internal
                } else {
                    Visibility::Public
                };
                functions.insert(name.lexeme.clone(), visibility);
            }
            _ => {}
        }
    }

    PackageExports {
        version: EXPORTS_VERSION,
        author,
        classes,
        functions,
        grammars: grammar_packages.to_vec(),
    }
}

/// Recursively collect method names from a class body.
fn collect_class_methods(
    stmt: &Stmt,
    class_is_internal: bool,
    methods: &mut Vec<String>,
    internal_methods: &mut Vec<String>,
) {
    match stmt {
        Stmt::Block(stmts) => {
            for s in stmts {
                collect_class_methods(s, class_is_internal, methods, internal_methods);
            }
        }
        Stmt::Fn {
            annotations,
            name,
            ..
        } => {
            if class_is_internal {
                methods.push(name.lexeme.clone());
            } else if has_internal_annotation(annotations) {
                internal_methods.push(name.lexeme.clone());
            } else {
                methods.push(name.lexeme.clone());
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::printing_press::inklang::ast::{Expr, Stmt};
    use crate::printing_press::inklang::token::{Token, TokenType};
    use std::collections::HashMap;

    fn dummy_token(lexeme: &str) -> Token {
        Token {
            typ: TokenType::Identifier,
            lexeme: lexeme.to_string(),
            line: 1,
            column: 0,
        }
    }

    fn make_class(name: &str, annotations: Vec<Expr>, methods: Vec<Stmt>) -> Stmt {
        Stmt::Class {
            annotations,
            name: dummy_token(name),
            superclass: None,
            body: Box::new(Stmt::Block(methods)),
        }
    }

    fn make_fn(name: &str, annotations: Vec<Expr>) -> Stmt {
        Stmt::Fn {
            annotations,
            name: dummy_token(name),
            params: vec![],
            return_type: None,
            body: Box::new(Stmt::Block(vec![])),
            is_async: false,
        }
    }

    fn internal_annotation() -> Expr {
        Expr::Annotation {
            name: "internal".to_string(),
            args: HashMap::new(),
        }
    }

    #[test]
    fn test_collect_public_class_with_methods() {
        let stmts = vec![make_class(
            "Wallet",
            vec![],
            vec![make_fn("get_balance", vec![]), make_fn("deposit", vec![])],
        )];

        let exports = collect_exports(&stmts, &[], None);

        assert_eq!(exports.classes.len(), 1);
        let wallet = &exports.classes["Wallet"];
        assert_eq!(wallet.visibility, Visibility::Public);
        assert_eq!(wallet.methods, vec!["get_balance", "deposit"]);
        assert!(wallet.internal_methods.is_empty());
    }

    #[test]
    fn test_collect_internal_class() {
        let stmts = vec![make_class(
            "Ledger",
            vec![internal_annotation()],
            vec![make_fn("reconcile", vec![])],
        )];

        let exports = collect_exports(&stmts, &[], None);

        let ledger = &exports.classes["Ledger"];
        assert_eq!(ledger.visibility, Visibility::Internal);
        assert_eq!(ledger.methods, vec!["reconcile"]);
        assert!(ledger.internal_methods.is_empty());
    }

    #[test]
    fn test_collect_public_class_with_internal_method() {
        let stmts = vec![make_class(
            "Wallet",
            vec![],
            vec![
                make_fn("get_balance", vec![]),
                make_fn("audit_log", vec![internal_annotation()]),
            ],
        )];

        let exports = collect_exports(&stmts, &[], None);

        let wallet = &exports.classes["Wallet"];
        assert_eq!(wallet.visibility, Visibility::Public);
        assert_eq!(wallet.methods, vec!["get_balance"]);
        assert_eq!(wallet.internal_methods, vec!["audit_log"]);
    }

    #[test]
    fn test_collect_functions() {
        let stmts = vec![
            make_fn("format_currency", vec![]),
            make_fn("parse_amount", vec![internal_annotation()]),
        ];

        let exports = collect_exports(&stmts, &[], None);

        assert_eq!(exports.functions["format_currency"], Visibility::Public);
        assert_eq!(exports.functions["parse_amount"], Visibility::Internal);
    }

    #[test]
    fn test_collect_grammars() {
        let exports = collect_exports(&[], &["ink.paper".to_string()], None);
        assert_eq!(exports.grammars, vec!["ink.paper"]);
    }

    #[test]
    fn test_exports_json_roundtrip() {
        let exports = PackageExports {
            version: 1,
            author: Some("test-author".to_string()),
            classes: BTreeMap::new(),
            functions: BTreeMap::new(),
            grammars: vec![],
        };
        let json = serde_json::to_string(&exports).unwrap();
        let parsed: PackageExports = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, exports);
    }
}
