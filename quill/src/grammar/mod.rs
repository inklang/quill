pub mod parser;
pub mod validator;
pub mod serializer;
pub mod merge;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrammarIr {
    pub package: String,
    pub rules: BTreeMap<String, GrammarRule>,
    pub keywords: BTreeMap<String, KeywordDef>,
    #[serde(default)]
    pub imports: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrammarRule {
    pub name: String,
    pub pattern: Pattern,
    pub handler: Option<String>,
    #[serde(default)]
    pub inherits: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Pattern {
    Keyword(String),
    Ident,
    Int,
    Float,
    String,
    Literal(String),
    Block(Vec<Pattern>),
    Choice(Vec<Pattern>),
    Sequence(Vec<Pattern>),
    Repeat(Box<Pattern>),
    Repeat1(Box<Pattern>),      // one or more (+)
    Optional(Box<Pattern>),
    Ref(String),                // $keyword reference
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeywordDef {
    pub name: String,
    pub inherits: Option<String>,
    #[serde(default)]
    pub rules: BTreeMap<String, GrammarRule>,
}
