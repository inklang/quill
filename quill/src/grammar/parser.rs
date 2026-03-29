use std::collections::BTreeMap;

use crate::error::{QuillError, Result};

use super::{GrammarIr, GrammarRule, KeywordDef, Pattern};

/// Recursive descent parser for .ink-grammar files.
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

    pub fn parse(&mut self) -> Result<GrammarIr> {
        // Grammar declaration is optional; if not present, package defaults to empty
        let package = if self.peek_word() == Some("grammar".to_string()) {
            // Must use parse_grammar_decl directly since peek_word doesn't consume
            self.expect_word("grammar")?;
            self.skip_whitespace();
            let name = self.parse_ident()?;
            self.skip_whitespace();
            self.expect_char(';')?;
            name
        } else {
            String::new()
        };
        let mut imports = Vec::new();
        let mut keywords = BTreeMap::new();

        loop {
            self.skip_whitespace_and_comments();
            if self.is_at_end() {
                break;
            }

            let word = self.peek_word();
            if word == Some("using".to_string()) {
                let import = self.parse_using_direct()?;
                imports.push(import);
            } else if word == Some("declare".to_string()) {
                let keyword = self.parse_declare_keyword_direct()?;
                keywords.insert(keyword.name.clone(), keyword);
            } else if word == Some("grammar".to_string()) {
                // Grammar declaration must be at the top; error if seen later
                return Err(self.error("grammar declaration must be at the top of the file"));
            } else {
                return Err(self.error(&format!("unexpected token at line {}, col {}", self.line, self.col)));
            }
        }

        Ok(GrammarIr {
            package,
            rules: BTreeMap::new(),
            keywords,
            imports,
        })
    }

    fn parse_grammar_decl(&mut self) -> Result<String> {
        self.expect_word("grammar")?;
        self.skip_whitespace();
        let name = self.parse_ident()?;
        self.skip_whitespace();
        self.expect_char(';')?;
        Ok(name)
    }

    // Direct versions that assume the keyword has already been consumed by peek_word in the main loop
    fn parse_using_direct(&mut self) -> Result<String> {
        // Must consume "using" keyword first (like parse_declare_keyword_direct consumes "declare")
        self.expect_word("using")?;
        self.skip_whitespace();
        let package = self.parse_ident()?;
        self.skip_whitespace();
        self.expect_char(';')?;
        Ok(package)
    }

    fn parse_declare_keyword_direct(&mut self) -> Result<KeywordDef> {
        // Must consume "declare" keyword first (like we now do for "using")
        self.expect_word("declare")?;
        self.skip_whitespace();
        let name = self.parse_ident()?;
        self.skip_whitespace();

        // Check for "inherits" without consuming (peek_word doesn't consume)
        let inherits = if self.peek_word() == Some("inherits".to_string()) {
            self.expect_word("inherits")?;
            self.skip_whitespace();
            let base = self.parse_ident()?;
            self.skip_whitespace();
            Some(base)
        } else {
            None
        };

        self.expect_char('{')?;
        self.skip_whitespace();

        let mut rules = BTreeMap::new();
        while self.peek_char() != Some('}') && !self.is_at_end() {
            let rule = self.parse_rule()?;
            rules.insert(rule.name.clone(), rule);
            self.skip_whitespace();
        }

        self.expect_char('}')?;
        Ok(KeywordDef { name, inherits, rules })
    }

    fn parse_rule(&mut self) -> Result<GrammarRule> {
        let name = self.parse_ident()?;
        self.skip_whitespace();
        self.expect_char('=')?;
        self.skip_whitespace();

        let pattern = self.parse_pattern()?;
        self.skip_whitespace();

        let handler = if self.check_str("->") {
            self.expect_str("->")?;
            self.skip_whitespace();
            Some(self.parse_ident()?)
        } else {
            None
        };

        self.skip_whitespace();
        self.expect_char(';')?;

        Ok(GrammarRule {
            name,
            pattern,
            handler,
            inherits: Vec::new(),
        })
    }

    fn parse_pattern(&mut self) -> Result<Pattern> {
        self.skip_whitespace();

        let tok = self.peek_word().ok_or_else(|| {
            self.error("expected pattern")
        })?;

        let pattern = match tok.as_str() {
            "keyword" => {
                self.expect_word("keyword")?;
                self.skip_whitespace();
                let s = self.parse_string_literal()?;
                Pattern::Keyword(s)
            }
            "ident" => {
                self.expect_word("ident")?;
                Pattern::Ident
            }
            "int" => {
                self.expect_word("int")?;
                Pattern::Int
            }
            "float" => {
                self.expect_word("float")?;
                Pattern::Float
            }
            "string" => {
                self.expect_word("string")?;
                Pattern::String
            }
            "(" => self.parse_block()?,
            "[" => self.parse_optional()?,
            "<" => self.parse_choice()?,
            _ => {
                if self.peek_char() == Some('"') || self.peek_char() == Some('\'') {
                    let lit = self.parse_string_literal()?;
                    Pattern::Literal(lit)
                } else if self.peek_char().map(|c| c.is_alphabetic()).unwrap_or(false) {
                    // Could be a repeat pattern like "rule*"
                    let word = self.parse_ident()?;
                    if self.check_char('*') {
                        Pattern::Repeat(Box::new(Pattern::Literal(word)))
                    } else if self.check_char('+') {
                        // + is Repeat + at least once (we model as Repeat for simplicity)
                        Pattern::Repeat(Box::new(Pattern::Literal(word)))
                    } else {
                        Pattern::Literal(word)
                    }
                } else {
                    return Err(self.error(&format!("unexpected pattern token: {}", tok)));
                }
            }
        };

        Ok(pattern)
    }

    fn parse_block(&mut self) -> Result<Pattern> {
        self.expect_char('(')?;
        self.skip_whitespace();
        let mut items = Vec::new();

        while !self.check_char(')') && !self.is_at_end() {
            let pat = self.parse_pattern()?;
            items.push(pat);
            self.skip_whitespace();
        }

        self.expect_char(')')?;
        Ok(Pattern::Block(items))
    }

    fn parse_optional(&mut self) -> Result<Pattern> {
        self.expect_char('[')?;
        self.skip_whitespace();
        let mut items = Vec::new();

        while !self.check_char(']') && !self.is_at_end() {
            let pat = self.parse_pattern()?;
            items.push(pat);
            self.skip_whitespace();
        }

        self.expect_char(']')?;

        if items.len() == 1 {
            Ok(Pattern::Optional(Box::new(items.into_iter().next().unwrap())))
        } else {
            Ok(Pattern::Optional(Box::new(Pattern::Sequence(items))))
        }
    }

    fn parse_choice(&mut self) -> Result<Pattern> {
        self.expect_char('<')?;
        self.skip_whitespace();
        let mut items = Vec::new();

        while !self.check_char('>') && !self.is_at_end() {
            let pat = self.parse_pattern()?;
            items.push(pat);
            self.skip_whitespace();
        }

        self.expect_char('>')?;
        Ok(Pattern::Choice(items))
    }

    fn parse_string_literal(&mut self) -> Result<String> {
        let quote = self.peek_char().ok_or_else(|| self.error("expected string literal"))?;

        if quote != '"' && quote != '\'' {
            return Err(self.error(&format!("expected string literal, got {:?}", quote)));
        }

        self.pos += 1;
        let _start = self.pos;
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
            } else {
                value.push(c);
            }
            self.pos += 1;
        }

        if self.pos >= self.input.len() {
            return Err(self.error("unterminated string literal"));
        }

        self.pos += 1; // consume closing quote
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
        if self.peek_char() == Some(expected) {
            self.pos += 1;
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
                    // Single-line comment
                    self.pos += 2;
                    self.col += 2;
                    while self.pos < self.input.len() && self.input[self.pos] != '\n' {
                        self.pos += 1;
                        self.col += 1;
                    }
                }
                '/' if self.pos + 1 < self.input.len() && self.input[self.pos + 1] == '*' => {
                    // Multi-line comment
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
        let source = "grammar my_grammar;";
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        assert_eq!(ir.package, "my_grammar");
    }

    #[test]
    fn test_parse_using_import() {
        let source = r#"
            grammar test;
            using ink.base;
            using ink.mobs;
        "#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        assert_eq!(ir.imports, vec!["ink.base", "ink.mobs"]);
    }

    #[test]
    fn test_parse_simple_keyword() {
        let source = r#"
            grammar test;

            declare spawn {
                rule_name = keyword "spawn";
            }
        "#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        assert!(ir.keywords.contains_key("spawn"));
    }

    #[test]
    fn test_parse_keyword_with_inherits() {
        let source = r#"
            grammar test;

            declare event inherits base_event {
                rule_name = keyword "event";
            }
        "#;
        let mut parser = GrammarParser::new(source);
        let ir = parser.parse().unwrap();
        let event = ir.keywords.get("event").unwrap();
        assert_eq!(event.inherits, Some("base_event".to_string()));
    }
}
