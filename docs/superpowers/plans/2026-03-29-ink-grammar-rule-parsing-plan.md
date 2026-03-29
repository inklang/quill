# Ink Grammar Rule Parsing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port rule parsing to Rust — quill authors grammars end-to-end without TypeScript.

**Architecture:** New grammar syntax parser (`grammar`, `import`, `keyword`, `rule`) replaces old parser entirely. `GrammarIr` is serialized to `GrammarPackage` JSON (`dist/grammar.ir.json`) which `printing_press::compile_with_grammar()` consumes. Clean break — no backward compat with TypeScript grammar IR.

**Tech Stack:** Rust (no external deps beyond existing ones), `serde`, `serde_json`, existing `GrammarParser` infrastructure.

---

## Chunk 1: Pattern Enum Variants

**Files:**
- Modify: `quill/src/grammar/mod.rs:28-42`

- [ ] **Step 1: Add Pattern::Ref and Pattern::Repeat1 variants**

Edit `quill/src/grammar/mod.rs` — add two new variants to the `Pattern` enum at line 41 (after `Optional`):

```rust
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
    Repeat(Box<Pattern>),       // zero or more (*)
    Repeat1(Box<Pattern>),      // one or more (+) — NEW
    Optional(Box<Pattern>),
    Ref(String),                // $keyword reference — NEW
}
```

- [ ] **Step 2: Run cargo check to verify compilation**

Run: `cd quill && cargo check 2>&1`
Expected: No errors related to Pattern enum. May have other errors — ignore for now.

- [ ] **Step 3: Commit**

```bash
git add quill/src/grammar/mod.rs
git commit -m "feat(grammar): add Pattern::Repeat1 and Pattern::Ref variants

Pattern::Repeat1 maps to Rule::Many1 (+) for one-or-more repetition.
Pattern::Ref(String) maps to Rule::Ref for $keyword references.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: GrammarSerializer — GrammarPackage JSON Output

**Files:**
- Modify: `quill/src/grammar/serializer.rs`

This chunk adds `serialize_grammar_package()` which converts a `GrammarIr` into the `GrammarPackage` JSON format that `printing_press::grammar::load_grammar()` expects.

**Key mapping (from spec section 3.4 and 3.5):**

| GrammarIr Pattern | printing_press Rule |
|---|---|
| `Literal(s)` | `Rule::Literal { value: s }` |
| `Ident` | `Rule::Identifier` |
| `Int` | `Rule::Int` |
| `Float` | `Rule::Float` |
| `String` | `Rule::String` |
| `Block(items)` | `Rule::Seq { items: mapped_items }` (grouping — NOT Rule::Block) |
| `Choice(v)` | `Rule::Choice { items: vec![...] }` |
| `Sequence(v)` | `Rule::Seq { items: vec![...] }` |
| `Repeat(p)` | `Rule::Many { item: Box::new(...) }` |
| `Repeat1(p)` | `Rule::Many1 { item: Box::new(...) }` |
| `Optional(p)` | `Rule::Optional { item: Box::new(...) }` |
| `Keyword(v)` | `Rule::Keyword { value: v }` |
| `Ref(name)` | `Rule::Ref { rule: name }` |

**Output structure** (per GrammarPackage schema):

```json
{
  "version": 1,
  "package": "mygame",
  "keywords": ["move", "north", "south", ...],
  "rules": {
    "player_move": { "rule": { "type": "seq", "items": [...] }, "handler": "handleMove" }
  },
  "declarations": []
}
```

Rules go to `declarations` if `GrammarRule.inherits` is non-empty (declarations with inheritance), otherwise to `rules`.

- [ ] **Step 1: Write the failing test**

Create `quill/src/grammar/serialize_grammar_package_test.rs` (temp file for development):

```rust
#[cfg(test)]
mod serialize_grammar_package_tests {
    use super::*;
    use crate::grammar::{GrammarIr, GrammarRule, GrammarSerializer, KeywordDef, Pattern};
    use crate::printing_press::inklang::grammar::{GrammarPackage, Rule};
    use std::collections::BTreeMap;

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd quill && cargo test serialize_grammar_package --no-run 2>&1`
Expected: compile error — `serialize_grammar_package` not found on `GrammarSerializer`

- [ ] **Step 3: Add serialize_grammar_package() to serializer**

Add to `quill/src/grammar/serializer.rs`:

```rust
use crate::grammar::{GrammarIr, GrammarRule, KeywordDef, Pattern};
use crate::printing_press::inklang::grammar::{DeclarationDef, GrammarPackage, Rule, RuleEntry};
use std::collections::BTreeMap;

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
    let mut rules: BTreeMap<String, RuleEntry> = BTreeMap::new();
    let mut declarations: Vec<DeclarationDef> = Vec::new();

    for (name, rule_def) in &ir.rules {
        let rule = pattern_to_rule(&rule_def.pattern);

        if rule_def.inherits.is_empty() {
            // General parsing rule → rules HashMap
            rules.insert(name.clone(), RuleEntry {
                rule,
                handler: rule_def.handler.clone(),
            });
        } else {
            // Has inheritance → declaration
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
        Pattern::Block(items) | Pattern::Optional(items) => {
            collect_literals(items, out);
        }
        Pattern::Repeat(p) | Pattern::Repeat1(p) => collect_literals(p, out),
        _ => {}
    }
}
```

Also add the import at the top of serializer.rs:
```rust
use crate::grammar::{GrammarIr, GrammarRule, KeywordDef, Pattern};
use crate::printing_press::inklang::grammar::{DeclarationDef, GrammarPackage, Rule, RuleEntry};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd quill && cargo test serialize_grammar_package 2>&1`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add quill/src/grammar/serializer.rs
git commit -m "feat(grammar): add serialize_grammar_package() for GrammarPackage JSON output

Converts GrammarIr to GrammarPackage JSON — the format printing_press's
load_grammar() expects. Rules with inherits go to declarations array;
rules without go to rules HashMap.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: GrammarParser — Complete Rewrite

**Files:**
- Modify: `quill/src/grammar/parser.rs`

This is the main chunk — the parser rewrite. The existing `parse()` method and all helper methods are replaced with new ones supporting the new syntax.

**New grammar syntax to support:**

```
grammar mypackage          // package declaration (no semicolon)
import base_engine          // import (no semicolon)
keyword direction = "north" | "south" | "east" | "west"  // keyword values separated by |
rule player_move -> "move" identifier int int           // -> pattern inline
rule on_click inherits on_event -> "click" identifier handler("handle_click")
rule attack -> entity "attacks" entity handler("handle_attack")
```

**Pattern EBNF (whitespace = sequence):**
```
pattern  := choice
choice   := seq ("|" seq)*
seq      := term+
term     := unit ("?" | "*" | "+")?
unit     := literal | "$" keyword | builtin | "(" pattern ")" | "[" pattern "]"
builtin  := "identifier" | "int" | "float" | "string"
literal  := '"' string '"'
```

**New parse loop structure:**

```rust
pub fn parse(&mut self) -> Result<GrammarIr> {
    // Parse optional "grammar <name>" at top
    let package = if self.check_word("grammar") {
        self.expect_word("grammar")?;
        self.skip_whitespace();
        let name = self.parse_ident()?;
        name
    } else {
        String::new()
    };

    let mut imports = Vec::new();
    let mut keywords = BTreeMap::new();
    let mut rules = BTreeMap::new();

    loop {
        self.skip_whitespace_and_comments();
        if self.is_at_end() { break; }

        match self.peek_word().as_deref() {
            Some("import")  => imports.push(self.parse_import()?),
            Some("keyword") => {
                let k = self.parse_keyword_decl()?;
                keywords.insert(k.name.clone(), k);
            }
            Some("rule")    => {
                let r = self.parse_rule_def()?;
                rules.insert(r.name.clone(), r);
            }
            Some("grammar") => return Err(self.error("grammar declaration must be at the top of the file")),
            _ => return Err(self.error(&format!("unexpected token at {}:{}", self.line, self.col))),
        }
    }

    Ok(GrammarIr { package, rules, keywords, imports })
}
```

**Helper methods to implement:**

| Method | What it parses |
|---|---|
| `parse_import()` | `import <ident>;` |
| `parse_keyword_decl()` | `keyword <ident> = "<val1>" \| "<val2>" ...;` |
| `parse_rule_def()` | `rule <ident> [inherits <ident>] -> <pattern> [handler(...)]?;` |
| `parse_pattern()` | entry — calls `parse_choice` |
| `parse_choice()` | `seq ("|" seq)*` |
| `parse_seq()` | `term+` (whitespace-separated) |
| `parse_term()` | `unit ("?" \| "*" \| "+")?` |
| `parse_unit()` | literal / $keyword / builtin / `(` pattern `)` / `[` pattern `]` |
| `parse_handler()` | `handler("<name>")` |

**Token keywords for built-in types:** `identifier`, `int`, `float`, `string`

- [ ] **Step 1: Write the failing parser tests**

Add to `#[cfg(test)]` section at the bottom of `quill/src/grammar/parser.rs`:

```rust
#[test]
fn test_parse_grammar_keyword_import() {
    let source = r#"
        grammar mygame;
        import base_engine;
        import physics;
    "#;
    let mut parser = GrammarParser::new(source);
    let ir = parser.parse().unwrap();
    assert_eq!(ir.package, "mygame");
    assert_eq!(ir.imports, vec!["base_engine", "physics"]);
}

#[test]
fn test_parse_keyword_decl() {
    let source = r#"keyword direction = "north" | "south" | "east" | "west";"#;
    let mut parser = GrammarParser::new(source);
    let ir = parser.parse().unwrap();
    assert!(ir.keywords.contains_key("direction"));
}

#[test]
fn test_parse_rule_no_inherits() {
    let source = r#"rule player_move -> "move" identifier int int;"#;
    let mut parser = GrammarParser::new(source);
    let ir = parser.parse().unwrap();
    let rule = ir.rules.get("player_move").unwrap();
    assert!(matches!(rule.pattern, Pattern::Sequence(_)));
    assert!(rule.inherits.is_empty());
}

#[test]
fn test_parse_rule_with_inherits_and_handler() {
    let source = r#"rule on_click inherits on_event -> "click" identifier handler("handle_click");"#;
    let mut parser = GrammarParser::new(source);
    let ir = parser.parse().unwrap();
    let rule = ir.rules.get("on_click").unwrap();
    assert_eq!(rule.inherits, vec!["on_event"]);
    assert_eq!(rule.handler, Some("handle_click".to_string()));
}

#[test]
fn test_parse_pattern_choice() {
    let source = r#"rule dir -> "north" | "south" | "east" | "west";"#;
    let mut parser = GrammarParser::new(source);
    let ir = parser.parse().unwrap();
    let rule = ir.rules.get("dir").unwrap();
    assert!(matches!(rule.pattern, Pattern::Choice(_)));
}

#[test]
fn test_parse_pattern_optional() {
    let source = r#"rule opt -> "move" identifier?;"#;
    let mut parser = GrammarParser::new(source);
    let ir = parser.parse().unwrap();
    let rule = ir.rules.get("opt").unwrap();
    assert!(matches!(rule.pattern, Pattern::Sequence(ref items) if matches!(items[1], Pattern::Optional(_))));
}

#[test]
fn test_parse_pattern_repeat() {
    let source = r#"rule ids -> identifier*;"#;
    let mut parser = GrammarParser::new(source);
    let ir = parser.parse().unwrap();
    let rule = ir.rules.get("ids").unwrap();
    assert!(matches!(rule.pattern, Pattern::Repeat(_)));
}

#[test]
fn test_parse_pattern_repeat1() {
    let source = r#"rule nums -> int+;"#;
    let mut parser = GrammarParser::new(source);
    let ir = parser.parse().unwrap();
    let rule = ir.rules.get("nums").unwrap();
    assert!(matches!(rule.pattern, Pattern::Repeat1(_)));
}

#[test]
fn test_parse_keyword_ref() {
    let source = r#"keyword move = "move"; rule mv -> $move identifier;"#;
    let mut parser = GrammarParser::new(source);
    let ir = parser.parse().unwrap();
    let rule = ir.rules.get("mv").unwrap();
    assert!(matches!(rule.pattern, Pattern::Sequence(ref items) if matches!(&items[0], Pattern::Ref(r) if r == "move")));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd quill && cargo test grammar::parser::tests 2>&1`
Expected: compile errors — new methods don't exist yet

- [ ] **Step 3: Implement the new parser**

Replace the entire content of `quill/src/grammar/parser.rs` with the new implementation. The new file:

```rust
use std::collections::BTreeMap;

use crate::error::{QuillError, Result};

use super::{GrammarIr, GrammarRule, KeywordDef, Pattern};

/// Recursive descent parser for .ink-grammar files (new syntax).
/// Replaces the old "declare keyword" syntax entirely.
pub struct GrammarParser {
    input: Vec<char>,
    pos: usize,
    line: usize,
    col: usize,
}

impl GrammarParser {
    pub fn new(source: &str) -> Self {
        Self {
            input: source.chars().collect(),
            pos: 0,
            line: 1,
            col: 1,
        }
    }

    /// Parse a full .ink-grammar file.
    pub fn parse(&mut self) -> Result<GrammarIr> {
        // Parse optional "grammar <name>" at top
        let package = if self.check_word("grammar") {
            self.expect_word("grammar")?;
            self.skip_whitespace();
            let name = self.parse_ident()?;
            name
        } else {
            String::new()
        };

        let mut imports = Vec::new();
        let mut keywords = BTreeMap::new();
        let mut rules = BTreeMap::new();

        loop {
            self.skip_whitespace_and_comments();
            if self.is_at_end() {
                break;
            }

            match self.peek_word().as_deref() {
                Some("import") => {
                    let imp = self.parse_import()?;
                    imports.push(imp);
                }
                Some("keyword") => {
                    let k = self.parse_keyword_decl()?;
                    keywords.insert(k.name.clone(), k);
                }
                Some("rule") => {
                    let r = self.parse_rule_def()?;
                    rules.insert(r.name.clone(), r);
                }
                Some("grammar") => {
                    return Err(self.error("grammar declaration must be at the top of the file"));
                }
                _ => {
                    return Err(self.error(&format!(
                        "unexpected token '{}' at {}:{}",
                        self.peek_word().unwrap_or_default(),
                        self.line,
                        self.col
                    )));
                }
            }
        }

        Ok(GrammarIr {
            package,
            rules,
            keywords,
            imports,
        })
    }

    /// Parse: import <ident>;
    fn parse_import(&mut self) -> Result<String> {
        self.expect_word("import")?;
        self.skip_whitespace();
        let pkg = self.parse_ident()?;
        self.skip_whitespace();
        self.expect_char(';')?;
        Ok(pkg)
    }

    /// Parse: keyword <ident> = "<val1>" | "<val2>" ...;
    fn parse_keyword_decl(&mut self) -> Result<KeywordDef> {
        self.expect_word("keyword")?;
        self.skip_whitespace();
        let name = self.parse_ident()?;
        self.skip_whitespace();
        self.expect_char('=')?;
        self.skip_whitespace();

        // Keyword values are stored as rules inside KeywordDef
        // We parse the first value as the keyword's rule pattern
        let first_value = self.parse_string_literal()?;
        let mut values = vec![first_value];

        while self.check_char('|') {
            self.skip_whitespace();
            values.push(self.parse_string_literal()?);
        }

        self.skip_whitespace();
        self.expect_char(';')?;

        // Build a Choice pattern from the values
        let pattern = if values.len() == 1 {
            Pattern::Literal(values.into_iter().next().unwrap())
        } else {
            Pattern::Choice(values.into_iter().map(Pattern::Literal).collect())
        };

        let mut rules = BTreeMap::new();
        rules.insert(name.clone(), GrammarRule {
            name: name.clone(),
            pattern,
            handler: None,
            inherits: Vec::new(),
        });

        Ok(KeywordDef {
            name,
            inherits: None,
            rules,
        })
    }

    /// Parse: rule <ident> [inherits <ident>] -> <pattern> [handler(...)]?;
    fn parse_rule_def(&mut self) -> Result<GrammarRule> {
        self.expect_word("rule")?;
        self.skip_whitespace();
        let name = self.parse_ident()?;
        self.skip_whitespace();

        // Optional: inherits <base>
        let inherits = if self.check_word("inherits") {
            self.skip_whitespace();
            let base = self.parse_ident()?;
            self.skip_whitespace();
            vec![base]
        } else {
            Vec::new()
        };

        // Expect "->" then pattern
        self.expect_str("->")?;
        self.skip_whitespace();
        let pattern = self.parse_pattern()?;

        // Optional: handler("name")
        let handler = if self.check_word("handler") {
            self.skip_whitespace();
            self.expect_char('(')?;
            self.skip_whitespace();
            let h = self.parse_string_literal()?;
            self.skip_whitespace();
            self.expect_char(')')?;
            self.skip_whitespace();
            Some(h)
        } else {
            None
        };

        self.skip_whitespace();
        self.expect_char(';')?;

        Ok(GrammarRule {
            name,
            pattern,
            handler,
            inherits,
        })
    }

    /// Parse a pattern: choice (entry point)
    fn parse_pattern(&mut self) -> Result<Pattern> {
        self.parse_choice()
    }

    /// Parse: seq ("|" seq)*
    fn parse_choice(&mut self) -> Result<Pattern> {
        let first = self.parse_seq()?;

        if self.check_char('|') {
            let mut items = vec![first];
            loop {
                self.skip_whitespace();
                items.push(self.parse_seq()?);
                if !self.check_char('|') {
                    break;
                }
            }
            Ok(Pattern::Choice(items))
        } else {
            Ok(first)
        }
    }

    /// Parse: term+
    fn parse_seq(&mut self) -> Result<Pattern> {
        let first = self.parse_term()?;

        // Keep consuming terms while they don't start choice or end
        let mut items = vec![first];
        loop {
            self.skip_whitespace();
            // Stop if we see | or ; or } or end
            if self.peek_char() == Some('|')
                || self.peek_char() == Some(';')
                || self.peek_char() == Some('}')
                || self.peek_char() == Some(')')
                || self.peek_char() == Some(']')
                || self.is_at_end()
            {
                break;
            }
            // Check if next token is a term-start
            let start_pos = self.pos;
            let term = self.parse_term();
            if term.is_err() {
                // Not a term — revert and stop
                self.pos = start_pos;
                break;
            }
            items.push(term?);
        }

        if items.len() == 1 {
            Ok(items.into_iter().next().unwrap())
        } else {
            Ok(Pattern::Sequence(items))
        }
    }

    /// Parse: unit ("?" | "*" | "+")?
    fn parse_term(&mut self) -> Result<Pattern> {
        let unit = self.parse_unit()?;

        self.skip_whitespace();
        let modifier = self.peek_char();

        match modifier {
            Some('?') => {
                self.pos += 1;
                self.col += 1;
                Ok(Pattern::Optional(Box::new(unit)))
            }
            Some('*') => {
                self.pos += 1;
                self.col += 1;
                Ok(Pattern::Repeat(Box::new(unit)))
            }
            Some('+') => {
                self.pos += 1;
                self.col += 1;
                Ok(Pattern::Repeat1(Box::new(unit)))
            }
            _ => Ok(unit),
        }
    }

    /// Parse: literal | $keyword | builtin | "(" pattern ")" | "[" pattern "]"
    fn parse_unit(&mut self) -> Result<Pattern> {
        self.skip_whitespace();

        let ch = self.peek_char().ok_or_else(|| self.error("expected pattern unit"))?;

        // String literal
        if ch == '"' {
            let lit = self.parse_string_literal()?;
            return Ok(Pattern::Literal(lit));
        }

        // Keyword reference: $name
        if ch == '$' {
            self.pos += 1;
            self.col += 1;
            self.skip_whitespace();
            let kw = self.parse_ident()?;
            return Ok(Pattern::Ref(kw));
        }

        // Grouping: ( pattern )
        if ch == '(' {
            self.expect_char('(')?;
            self.skip_whitespace();
            let inner = self.parse_pattern()?;
            self.skip_whitespace();
            self.expect_char(')')?;
            return Ok(Pattern::Block(vec![inner])); // Block = grouping wrapper
        }

        // Optional shorthand: [ pattern ]
        if ch == '[' {
            self.expect_char('[')?;
            self.skip_whitespace();
            let inner = self.parse_pattern()?;
            self.skip_whitespace();
            self.expect_char(']')?;
            return Ok(Pattern::Optional(Box::new(inner)));
        }

        // Must be a word (identifier, keyword ref, or builtin)
        let word = self.peek_word().ok_or_else(|| self.error("expected pattern unit"))?;

        match word.as_str() {
            "identifier" => {
                self.expect_word("identifier")?;
                Ok(Pattern::Ident)
            }
            "int" => {
                self.expect_word("int")?;
                Ok(Pattern::Int)
            }
            "float" => {
                self.expect_word("float")?;
                Ok(Pattern::Float)
            }
            "string" => {
                self.expect_word("string")?;
                Ok(Pattern::String)
            }
            _ => {
                // It could be a keyword reference without $ prefix — treat as Ref
                // (allows `rule mv -> move identifier;` as shorthand for `$move`)
                self.pos += word.len();
                self.col += word.len();
                Ok(Pattern::Ref(word))
            }
        }
    }

    fn parse_string_literal(&mut self) -> Result<String> {
        let quote = self.peek_char().ok_or_else(|| self.error("expected string literal"))?;
        if quote != '"' && quote != '\'' {
            return Err(self.error(&format!("expected string literal, got {:?}", quote)));
        }

        self.pos += 1;
        self.col += 1;
        let mut value = String::new();

        while self.pos < self.input.len() && self.input[self.pos] != quote {
            let c = self.input[self.pos];
            if c == '\\' && self.pos + 1 < self.input.len() {
                self.pos += 1;
                let escaped = self.input[self.pos];
                match escaped {
                    'n' => value.push('\n'),
                    'r' => value.push('\r'),
                    't' => value.push('\t'),
                    '\\' => value.push('\\'),
                    '"' => value.push('"'),
                    '\'' => value.push('\''),
                    _ => value.push(escaped),
                }
            } else if c == '\n' {
                return Err(self.error("unterminated string literal"));
            } else {
                value.push(c);
            }
            self.pos += 1;
            self.col += 1;
        }

        if self.pos >= self.input.len() {
            return Err(self.error("unterminated string literal"));
        }

        self.pos += 1; // consume closing quote
        self.col += 1;
        Ok(value)
    }

    fn parse_ident(&mut self) -> Result<String> {
        self.skip_whitespace();

        let start = self.pos;
        if start >= self.input.len() || !self.input[start].is_alphabetic() {
            return Err(self.error("expected identifier"));
        }

        self.pos += 1;
        self.col += 1;
        while self.pos < self.input.len() {
            let c = self.input[self.pos];
            if c.is_alphanumeric() || c == '_' || c == '-' || c == '.' || c == ':' {
                self.pos += 1;
                self.col += 1;
            } else {
                break;
            }
        }

        Ok(self.input[start..self.pos].iter().collect())
    }

    fn peek_word(&mut self) -> Option<String> {
        self.skip_whitespace();
        let start = self.pos;
        if start >= self.input.len() || !self.input[start].is_alphabetic() {
            return None;
        }

        let mut end = start + 1;
        while end < self.input.len() {
            let c = self.input[end];
            if c.is_alphanumeric() || c == '_' || c == '-' {
                end += 1;
            } else {
                break;
            }
        }

        Some(self.input[start..end].iter().collect())
    }

    fn peek_char(&self) -> Option<char> {
        self.input.get(self.pos).copied()
    }

    fn check_char(&mut self, expected: char) -> bool {
        self.skip_whitespace();
        if self.peek_char() == Some(expected) {
            self.pos += 1;
            self.col += 1;
            true
        } else {
            false
        }
    }

    fn check_word(&mut self, word: &str) -> bool {
        let backup_line = self.line;
        let backup_col = self.col;
        let backup_pos = self.pos;

        self.skip_whitespace();
        let start = self.pos;

        if start + word.len() <= self.input.len() {
            let slice: String = self.input[start..start + word.len()].iter().collect();
            if slice == word {
                let next_pos = start + word.len();
                if next_pos >= self.input.len() || !self.input[next_pos].is_alphanumeric() {
                    self.pos = next_pos;
                    return true;
                }
            }
        }

        self.line = backup_line;
        self.col = backup_col;
        self.pos = backup_pos;
        false
    }

    fn check_str(&mut self, s: &str) -> bool {
        let backup_line = self.line;
        let backup_col = self.col;
        let backup_pos = self.pos;

        self.skip_whitespace();
        let start = self.pos;

        if start + s.len() <= self.input.len() {
            let slice: String = self.input[start..start + s.len()].iter().collect();
            if slice == s {
                self.pos = start + s.len();
                return true;
            }
        }

        self.line = backup_line;
        self.col = backup_col;
        self.pos = backup_pos;
        false
    }

    fn expect_word(&mut self, word: &str) -> Result<()> {
        self.skip_whitespace();
        if !self.check_word(word) {
            return Err(self.error(&format!("expected '{}'", word)));
        }
        Ok(())
    }

    fn expect_str(&mut self, s: &str) -> Result<()> {
        self.skip_whitespace();
        if !self.check_str(s) {
            return Err(self.error(&format!("expected '{}'", s)));
        }
        Ok(())
    }

    fn expect_char(&mut self, expected: char) -> Result<()> {
        self.skip_whitespace();
        if self.peek_char() == Some(expected) {
            self.pos += 1;
            self.col += 1;
            Ok(())
        } else {
            Err(self.error(&format!("expected '{}'", expected)))
        }
    }

    fn skip_whitespace(&mut self) {
        while self.pos < self.input.len() {
            let c = self.input[self.pos];
            match c {
                ' ' | '\t' | '\r' => {
                    self.pos += 1;
                    self.col += 1;
                }
                '\n' => {
                    self.pos += 1;
                    self.line += 1;
                    self.col = 1;
                }
                '/' if self.pos + 1 < self.input.len() && self.input[self.pos + 1] == '/' => {
                    self.pos += 2;
                    self.col += 2;
                    while self.pos < self.input.len() && self.input[self.pos] != '\n' {
                        self.pos += 1;
                        self.col += 1;
                    }
                }
                '/' if self.pos + 1 < self.input.len() && self.input[self.pos + 1] == '*' => {
                    self.pos += 2;
                    self.col += 2;
                    while self.pos + 1 < self.input.len() {
                        if self.input[self.pos] == '*' && self.input[self.pos + 1] == '/' {
                            self.pos += 2;
                            self.col += 2;
                            break;
                        }
                        if self.input[self.pos] == '\n' {
                            self.line += 1;
                            self.col = 1;
                        }
                        self.pos += 1;
                        self.col += 1;
                    }
                }
                _ => break,
            }
        }
    }

    fn skip_whitespace_and_comments(&mut self) {
        loop {
            let before = self.pos;
            self.skip_whitespace();
            if before == self.pos {
                break;
            }
        }
    }

    fn is_at_end(&self) -> bool {
        self.pos >= self.input.len()
    }

    fn error(&self, msg: &str) -> QuillError {
        QuillError::GrammarParse {
            path: std::path::PathBuf::from("<inline>"),
            message: msg.to_string(),
            line: self.line,
            col: self.col,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_grammar_decl() {
        let source = "grammar my_grammar";  // no semicolon
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        assert_eq!(ir.package, "my_grammar");
    }

    #[test]
    fn test_parse_import() {
        let source = r#"
            grammar test;
            import ink.base;
            import physics;
        "#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        assert_eq!(ir.imports, vec!["ink.base", "physics"]);
    }

    #[test]
    fn test_parse_keyword_decl() {
        let source = r#"keyword direction = "north" | "south" | "east" | "west";"#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        assert!(ir.keywords.contains_key("direction"));
    }

    #[test]
    fn test_parse_rule_no_inherits() {
        let source = r#"rule player_move -> "move" identifier int int;"#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        let rule = ir.rules.get("player_move").unwrap();
        assert!(rule.inherits.is_empty());
        assert!(matches!(rule.pattern, Pattern::Sequence(_)));
    }

    #[test]
    fn test_parse_rule_with_inherits_and_handler() {
        let source = r#"rule on_click inherits on_event -> "click" identifier handler("handle_click");"#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        let rule = ir.rules.get("on_click").unwrap();
        assert_eq!(rule.inherits, vec!["on_event"]);
        assert_eq!(rule.handler, Some("handle_click".to_string()));
    }

    #[test]
    fn test_parse_pattern_choice() {
        let source = r#"rule dir -> "north" | "south" | "east" | "west";"#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        let rule = ir.rules.get("dir").unwrap();
        assert!(matches!(rule.pattern, Pattern::Choice(_)));
    }

    #[test]
    fn test_parse_pattern_optional() {
        let source = r#"rule opt -> "move" identifier?;"#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        let rule = ir.rules.get("opt").unwrap();
        // pattern is Sequence: [Literal("move"), Optional(Ident)]
        assert!(matches!(rule.pattern, Pattern::Sequence(ref items) if items.len() == 2));
    }

    #[test]
    fn test_parse_pattern_repeat() {
        let source = r#"rule ids -> identifier*;"#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        let rule = ir.rules.get("ids").unwrap();
        assert!(matches!(rule.pattern, Pattern::Repeat(_)));
    }

    #[test]
    fn test_parse_pattern_repeat1() {
        let source = r#"rule nums -> int+;"#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        let rule = ir.rules.get("nums").unwrap();
        assert!(matches!(rule.pattern, Pattern::Repeat1(_)));
    }

    #[test]
    fn test_parse_keyword_ref() {
        let source = r#"keyword move = "move"; rule mv -> $move identifier;"#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        let rule = ir.rules.get("mv").unwrap();
        assert!(matches!(
            rule.pattern,
            Pattern::Sequence(ref items) if matches!(&items[0], Pattern::Ref(r) if r == "move")
        ));
    }

    #[test]
    fn test_parse_full_grammar() {
        let source = r#"
            grammar mygame;
            import base_engine;
            keyword move = "move";
            keyword direction = "north" | "south" | "east" | "west";
            rule player_move -> $move identifier int int handler("handleMove");
            rule on_click inherits on_event -> "click" identifier handler("handleClick");
        "#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        assert_eq!(ir.package, "mygame");
        assert_eq!(ir.imports, vec!["base_engine"]);
        assert!(ir.keywords.contains_key("move"));
        assert!(ir.keywords.contains_key("direction"));
        assert!(ir.rules.contains_key("player_move"));
        assert!(ir.rules.contains_key("on_click"));
        assert_eq!(ir.rules.get("on_click").unwrap().inherits, vec!["on_event"]);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd quill && cargo test grammar::parser::tests 2>&1`
Expected: PASS (all tests)

If failures: read the error output, fix the parser logic, re-run.

- [ ] **Step 5: Commit**

```bash
git add quill/src/grammar/parser.rs
git commit -m "feat(grammar): rewrite GrammarParser with new rule syntax

New syntax: grammar, import, keyword (with | for values), rule (with ->
pattern, inherits, handler). Complete EBNF pattern parser: choice,
sequence, optional (?), repeat (*), repeat1 (+), keyword refs ($name),
builtins (identifier, int, float, string).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: Build Pipeline — Use Serialized Grammar

**Files:**
- Modify: `quill/src/commands/build.rs`

The `compile_ink()` function in `build.rs` uses `compile()` (auto-discovery via `dist/grammar.ir.json`). We replace it with `compile_with_grammar()` using an explicit `MergedGrammar` constructed in-memory.

**The flow (simplified — no disk round-trip):**
```
GrammarIr parsed + merged (already done in build.rs)
    │
    ▼
serialize_grammar_package(&merged_grammar) → GrammarPackage
    │
    ▼
merge_grammars(vec![grammar_pkg]) → MergedGrammar
    │
    ▼
compile_with_grammar(source, name, Some(&merged_grammar)) per file
```

- [ ] **Step 1: Read the current build.rs compile section**

Read `quill/src/commands/build.rs` around lines 100-140. Understand:
- Where `compile_ink()` is called in the file loop
- Where the grammar is merged (`merge_grammars` call)

- [ ] **Step 2: Add serialize_grammar_package import to build.rs**

At the top of `quill/src/commands/build.rs`, add:
```rust
use crate::grammar::serialize_grammar_package;
```

- [ ] **Step 3: Add compile_ink_with_grammar helper**

After the existing imports section (or near `compile_ink`), add:

```rust
/// Compile an .ink source file using an explicit MergedGrammar.
fn compile_ink_with_grammar(
    source: &Path,
    output: &Path,
    grammar: &crate::printing_press::inklang::grammar::MergedGrammar,
) -> Result<()> {
    let source_text = std::fs::read_to_string(source)
        .map_err(|e| QuillError::io_error(format!("failed to read source '{}'", source.display()), e))?;

    let name = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("main");

    let script = crate::printing_press::compile_with_grammar(&source_text, name, Some(grammar))
        .map_err(|e| QuillError::CompilerFailed {
            script: source.to_string_lossy().into(),
            stderr: e.display(),
        })?;

    let json = serde_json::to_string(&script)
        .map_err(|e| QuillError::RegistryAuth {
            message: format!("failed to serialize compiled output: {}", e),
        })?;

    std::fs::write(output, json)
        .map_err(|e| QuillError::io_error(format!("failed to write output '{}'", output.display()), e))?;

    Ok(())
}
```

- [ ] **Step 4: Build MergedGrammar before the file loop**

After the `merge_grammars` call (after line 83 in build.rs), add:

```rust
// Serialize GrammarIr to GrammarPackage, then build MergedGrammar in-memory
let grammar_pkg = serialize_grammar_package(&merged_grammar);
let grammar_for_compiler = crate::printing_press::inklang::grammar::merge_grammars(vec![grammar_pkg]);
```

This `grammar_for_compiler` is `MergedGrammar` (not JSON). No disk writes needed.

- [ ] **Step 5: Replace compile_ink calls with compile_ink_with_grammar**

In the file compilation loop (around line 127), replace:
```rust
compile_ink(source_file, &output_file)?
```
with:
```rust
compile_ink_with_grammar(source_file, &output_file, &grammar_for_compiler)?
```

- [ ] **Step 6: Run cargo build**

Run: `cd quill && cargo build 2>&1`
Expected: compile errors — fix them. Common issues: missing imports, wrong type for `grammar_for_compiler`.

- [ ] **Step 7: Run tests**

Run: `cd quill && cargo test 2>&1 | head -80`
Expected: tests pass (or pre-existing failures unrelated to this change)

- [ ] **Step 8: Commit**

```bash
git add quill/src/commands/build.rs
git commit -m "feat(build): use compile_with_grammar with explicit MergedGrammar

Build MergedGrammar in-memory from serialized GrammarPackage, pass it
directly to compile_with_grammar() for each .ink file. printing_press
auto-discovery no longer needed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: Full Round-Trip Test

**Files:**
- Add to: `quill/src/grammar/serializer.rs` (inline `#[cfg(test)]` module)

**Note:** There is no `lib.rs` — quill is binary-only. Tests must live as inline `#[cfg(test)]` modules in source files, not as separate files in `tests/`.

- [ ] **Step 1: Write the round-trip test**

Add a new `mod tests` block at the bottom of `quill/src/grammar/serializer.rs` (after the existing `mod tests`):

```rust
#[cfg(test)]
mod round_trip_tests {
    use super::*;
    use crate::grammar::parser::GrammarParser;
    use std::collections::BTreeMap;

    #[test]
    fn test_parse_serialize_round_trip() {
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
        let mut kw_rules = BTreeMap::new();
        kw_rules.insert("direction".to_string(), kw_rule);

        let mut keywords = BTreeMap::new();
        keywords.insert("direction".to_string(), KeywordDef {
            name: "direction".to_string(),
            inherits: None,
            rules: kw_rules,
        });

        let ir = GrammarIr {
            package: "mygame".to_string(),
            rules: BTreeMap::new(),
            keywords,
            imports: vec!["base".to_string()],
        };

        // Serialize
        let pkg = GrammarSerializer::serialize_grammar_package(&ir);

        // Verify
        assert_eq!(pkg.version, 1);
        assert_eq!(pkg.package, "mygame");
        assert!(pkg.keywords.contains(&"north".to_string()));
        assert!(pkg.keywords.contains(&"south".to_string()));
    }

    #[test]
    fn test_parse_then_serialize() {
        // Full parse → GrammarIr → GrammarPackage round-trip
        let source = r#"
            grammar mygame;
            import base;
            keyword move = "move";
            keyword dir = "north" | "south" | "east" | "west";
            rule player_move -> $move identifier int int handler("handleMove");
            rule on_click inherits on_event -> "click" identifier handler("handleClick");
        "#;

        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();

        // Verify GrammarIr
        assert_eq!(ir.package, "mygame");
        assert_eq!(ir.imports, vec!["base"]);
        assert!(ir.keywords.contains_key("move"));
        assert!(ir.keywords.contains_key("dir"));
        assert!(ir.rules.contains_key("player_move"));
        assert!(ir.rules.contains_key("on_click"));
        assert_eq!(ir.rules.get("on_click").unwrap().inherits, vec!["on_event"]);

        // Serialize to GrammarPackage
        let pkg = GrammarSerializer::serialize_grammar_package(&ir);

        assert_eq!(pkg.version, 1);
        assert_eq!(pkg.package, "mygame");
        assert!(pkg.keywords.contains(&"move".to_string()));
        assert!(pkg.keywords.contains(&"north".to_string()));
        assert!(pkg.rules.contains_key("player_move"));
        assert!(pkg.declarations.iter().any(|d| d.keyword == "on_click"));
    }
}
```

- [ ] **Step 2: Run the round-trip tests**

Run: `cd quill && cargo test serialize_grammar_package 2>&1`
Expected: PASS (all round_trip_tests)

- [ ] **Step 3: Commit**

```bash
git add quill/src/grammar/serializer.rs
git commit -m "test(grammar): add parse-serialize round-trip tests

Verify GrammarParser produces correct GrammarIr and GrammarSerializer
produces correct GrammarPackage JSON.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
