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
        // Parse optional "grammar <name>" at top (semicolon optional)
        let package = if self.check_word("grammar") {
            self.skip_whitespace();
            let name = self.parse_ident()?;
            // Optional semicolon after grammar declaration
            self.skip_whitespace();
            let _ = self.check_char(';');
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
                    let word = self.peek_word().unwrap_or_default();
                    return Err(self.error(&format!(
                        "unexpected token '{}' at {}:{}",
                        word,
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
            // Stop if we see | or ; or } or end or ) or ]
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
        // Look ahead: if we see Word followed by '(', this is "handler(" or similar
        // and should NOT be consumed as a Ref - stop parsing the sequence instead
        let lookahead_result = self.check_word_followed_by_paren();
        if lookahead_result.is_some() {
            return Err(self.error(&format!("unexpected '{}'", lookahead_result.unwrap())));
        }

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
            return Ok(Pattern::Block(vec![inner]));
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

    /// Check if current position has a word followed by '('.
    /// If so, return Some(word). Otherwise, return None.
    /// Does NOT consume any input.
    fn check_word_followed_by_paren(&mut self) -> Option<String> {
        let start_pos = self.pos;
        let start_col = self.col;
        let start_line = self.line;

        // Skip whitespace to find the word start
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
                _ => break,
            }
        }

        // Now check if we have a word
        if self.pos >= self.input.len() || !self.input[self.pos].is_alphabetic() {
            self.pos = start_pos;
            self.col = start_col;
            self.line = start_line;
            return None;
        }

        // Find end of word
        let word_start = self.pos;
        self.pos += 1;
        self.col += 1;
        while self.pos < self.input.len() {
            let c = self.input[self.pos];
            if c.is_alphanumeric() || c == '_' || c == '-' {
                self.pos += 1;
                self.col += 1;
            } else {
                break;
            }
        }
        let word_end = self.pos;

        // Restore position
        self.pos = start_pos;
        self.col = start_col;
        self.line = start_line;

        // Check if word is followed by '('
        if word_end < self.input.len() && self.input[word_end] == '(' {
            let word: String = self.input[word_start..word_end].iter().collect();
            Some(word)
        } else {
            None
        }
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
                self.col = backup_col + s.len();
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
