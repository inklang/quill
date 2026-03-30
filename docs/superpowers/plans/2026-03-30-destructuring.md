# Destructuring Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tuple and map destructuring to `let`, `const`, and `for` statements in the Ink compiler.

**Architecture:** Pure compiler change in three files. A new `Pattern` enum is added to the AST. The parser gains `parse_pattern()` which is called from the existing `parse_var()` and `parse_for()`. The lowerer gains `lower_pattern()` which desugars patterns into existing `LoadImm` + `GetIndex` (tuple) and `GetField` (map) IR instructions. No VM, IR, or codegen changes.

**Tech Stack:** Rust, `cargo test` for all verification.

**Spec:** `docs/superpowers/specs/2026-03-30-destructuring-design.md`

---

## Chunk 1: AST — Pattern Enum

### Task 1: Add Pattern enum to ast.rs

**Files:**
- Modify: `src/printing_press/inklang/ast.rs`

- [ ] **Step 1: Add the Pattern enum**

In `src/printing_press/inklang/ast.rs`, add this enum after the `AnnotationField` struct (around line 47):

```rust
/// A destructuring pattern used in let/const/for bindings.
#[derive(Debug, Clone)]
pub enum Pattern {
    /// Simple name binding: `x`
    Bind(Token),
    /// Wildcard: `_` — discards the value
    Wildcard,
    /// Tuple/list positional: `(a, b, c)`
    Tuple(Vec<Pattern>),
    /// Map field binding: `{name}` or `{name: renamed}`
    /// Each entry is (field_name_token, optional_rename_token).
    Map(Vec<(Token, Option<Token>)>),
}
```

- [ ] **Step 2: Update Stmt::Let to use Pattern**

Replace the `name: Token` field with `pattern: Pattern` in `Stmt::Let`:

```rust
/// Let binding: let x = 5
Let {
    annotations: Vec<Expr>,
    pattern: Pattern,
    type_annot: Option<Token>,
    value: Expr,
},
```

- [ ] **Step 3: Update Stmt::Const to use Pattern**

```rust
/// Const binding: const x = 5
Const {
    pattern: Pattern,
    type_annot: Option<Token>,
    value: Expr,
},
```

- [ ] **Step 4: Update Stmt::For to use Pattern**

```rust
/// For range loop: for i in 0..10 { ... }
For {
    pattern: Pattern,
    iterable: Expr,
    body: Box<Stmt>,
},
```

- [ ] **Step 5: Fix the lowerer's existing Stmt::Let/Const/For matches**

In `src/printing_press/inklang/lowerer.rs`, the compiler will now fail on the old field names. Update all destructuring matches to use `pattern` instead of `name`/`variable`:

At line 127, update `Stmt::Let`:
```rust
Stmt::Let { pattern, value, .. } => {
    if let Pattern::Bind(name) = pattern {
        self.lower_var(name, Some(value));
    } else {
        // Full pattern support added in Chunk 3
        panic!("destructuring patterns not yet lowered");
    }
}
```

At line 128, update `Stmt::Const`:
```rust
Stmt::Const { pattern, value, .. } => {
    if let Pattern::Bind(name) = pattern {
        self.lower_var(name, Some(value));
        self.const_locals.insert(name.lexeme.clone());
    } else {
        panic!("destructuring patterns not yet lowered");
    }
}
```

At line 152, update `Stmt::For`:
```rust
Stmt::For { pattern, iterable, body } => {
    if let Pattern::Bind(variable) = pattern {
        self.lower_for(variable, iterable, body);
    } else {
        panic!("destructuring patterns not yet lowered");
    }
}
```

- [ ] **Step 6: Fix class body field matching in lowerer.rs**

The lowerer inspects class bodies by matching `Stmt::Let`. These are at approximately lines 508 and 523. Update them:

```rust
// Line ~508: was `if let Stmt::Let { name: field_name, .. } = member`
if let Stmt::Let { pattern: Pattern::Bind(field_name), .. } = member
```

```rust
// Line ~523: was `if let Stmt::Let { name: field_name, value, .. } = field`
if let Stmt::Let { pattern: Pattern::Bind(field_name), value, .. } = field
```

- [ ] **Step 7: Fix the parser's Stmt::Let/Const/For construction**

In `src/printing_press/inklang/parser.rs`, `parse_var()` builds `Stmt::Let` and `Stmt::Const`. Update the field name `name` → `pattern: Pattern::Bind(name)`:

```rust
// Around line 259
if keyword.typ == TokenType::KwConst {
    Ok(Stmt::Const {
        pattern: Pattern::Bind(name),
        type_annot,
        value: value.unwrap_or(Expr::Literal(Value::Null)),
    })
} else {
    Ok(Stmt::Let {
        annotations,
        pattern: Pattern::Bind(name),
        type_annot,
        value: value.unwrap_or(Expr::Literal(Value::Null)),
    })
}
```

In `parse_for()` around line 426:
```rust
Ok(Stmt::For {
    pattern: Pattern::Bind(variable),
    iterable,
    body: Box::new(body),
})
```

Add the import at the top of parser.rs if needed:
```rust
use super::ast::Pattern;
```

- [ ] **Step 8: Fix any remaining test constructions**

Search for and update any test code in `ast.rs`, `parser.rs`, or `lowerer.rs` that directly constructs `Stmt::Let { name: ... }`, `Stmt::Const { name: ... }`, or `Stmt::For { variable: ... }`:

```bash
grep -n "Stmt::Let {" src/printing_press/inklang/lowerer.rs
grep -n "Stmt::Const {" src/printing_press/inklang/lowerer.rs
grep -n "Stmt::For {" src/printing_press/inklang/lowerer.rs
```

Update each to use `pattern: Pattern::Bind(...)`.

- [ ] **Step 9: Verify compilation**

```bash
cd /c/Users/justi/dev/quill && cargo check 2>&1
```

Expected: zero errors. Warnings about unused `Pattern` variants are fine.

- [ ] **Step 10: Run existing tests**

```bash
cd /c/Users/justi/dev/quill && cargo test --lib 2>&1 | tail -20
```

Expected: all tests pass (the panic stubs won't be hit by existing tests).

- [ ] **Step 11: Commit**

```bash
git add src/printing_press/inklang/ast.rs \
        src/printing_press/inklang/lowerer.rs \
        src/printing_press/inklang/parser.rs
git commit -m "feat(ast): add Pattern enum; migrate Let/Const/For to pattern field"
```

---

## Chunk 2: Parser — parse_pattern()

### Task 2: Add parse_pattern() and update parse_var / parse_for

**Files:**
- Modify: `src/printing_press/inklang/parser.rs`

- [ ] **Step 1: Write failing tests for parse_pattern**

Add these tests to the `#[cfg(test)]` block at the bottom of `parser.rs`:

```rust
#[test]
fn test_parse_tuple_destructure() {
    let stmts = parse("let (a, b) = pair");
    match &stmts[0] {
        Stmt::Let { pattern: Pattern::Tuple(pats), .. } => {
            assert_eq!(pats.len(), 2);
            assert!(matches!(&pats[0], Pattern::Bind(t) if t.lexeme == "a"));
            assert!(matches!(&pats[1], Pattern::Bind(t) if t.lexeme == "b"));
        }
        _ => panic!("expected Tuple pattern"),
    }
}

#[test]
fn test_parse_tuple_destructure_with_wildcard() {
    let stmts = parse("let (x, _, z) = triple");
    match &stmts[0] {
        Stmt::Let { pattern: Pattern::Tuple(pats), .. } => {
            assert_eq!(pats.len(), 3);
            assert!(matches!(&pats[0], Pattern::Bind(_)));
            assert!(matches!(&pats[1], Pattern::Wildcard));
            assert!(matches!(&pats[2], Pattern::Bind(_)));
        }
        _ => panic!("expected Tuple pattern"),
    }
}

#[test]
fn test_parse_map_destructure() {
    let stmts = parse("let {name, health} = player");
    match &stmts[0] {
        Stmt::Let { pattern: Pattern::Map(fields), .. } => {
            assert_eq!(fields.len(), 2);
            assert_eq!(fields[0].0.lexeme, "name");
            assert!(fields[0].1.is_none());
            assert_eq!(fields[1].0.lexeme, "health");
        }
        _ => panic!("expected Map pattern"),
    }
}

#[test]
fn test_parse_map_destructure_with_rename() {
    let stmts = parse("let {name: n, health: hp} = player");
    match &stmts[0] {
        Stmt::Let { pattern: Pattern::Map(fields), .. } => {
            assert_eq!(fields.len(), 2);
            assert_eq!(fields[0].0.lexeme, "name");
            assert_eq!(fields[0].1.as_ref().unwrap().lexeme, "n");
            assert_eq!(fields[1].0.lexeme, "health");
            assert_eq!(fields[1].1.as_ref().unwrap().lexeme, "hp");
        }
        _ => panic!("expected Map pattern"),
    }
}

#[test]
fn test_parse_nested_tuple_destructure() {
    let stmts = parse("let (a, (b, c)) = nested");
    match &stmts[0] {
        Stmt::Let { pattern: Pattern::Tuple(pats), .. } => {
            assert_eq!(pats.len(), 2);
            assert!(matches!(&pats[0], Pattern::Bind(_)));
            assert!(matches!(&pats[1], Pattern::Tuple(_)));
        }
        _ => panic!("expected Tuple pattern"),
    }
}

#[test]
fn test_parse_tuple_error_single_element() {
    // (a) with one element must fail
    let result = std::panic::catch_unwind(|| parse("let (a) = x"));
    assert!(result.is_err() || {
        // Or check via the parser's error path
        let mut parser = Parser::new_from_source("let (a) = x");
        parser.parse().is_err()
    });
}

#[test]
fn test_parse_for_tuple_pattern() {
    let stmts = parse("for (x, y) in points { }");
    assert!(matches!(&stmts[0], Stmt::For { pattern: Pattern::Tuple(_), .. }));
}

#[test]
fn test_parse_const_tuple_destructure() {
    let stmts = parse("const (W, H) = dims");
    assert!(matches!(&stmts[0], Stmt::Const { pattern: Pattern::Tuple(_), .. }));
}
```

- [ ] **Step 2: Run the failing tests**

```bash
cd /c/Users/justi/dev/quill && cargo test parse_tuple_destructure parse_map_destructure parse_nested parse_for_tuple parse_const_tuple 2>&1 | tail -20
```

Expected: compile error or test failures (parse_pattern doesn't exist yet).

- [ ] **Step 3: Add parse_pattern() method**

Add this method to the `Parser` impl block in `parser.rs`, near `parse_var`:

```rust
/// Parse a destructuring pattern.
/// Called in let/const/for position where a variable name is expected.
/// Dispatches on the next token:
///   `(` → Tuple pattern
///   `{` → Map pattern
///   `_` identifier → Wildcard
///   identifier → Bind
fn parse_pattern(&mut self) -> Result<Pattern> {
    if self.check(&TokenType::LParen) {
        self.advance(); // consume '('
        let mut patterns = Vec::new();
        loop {
            if self.check(&TokenType::RParen) {
                break;
            }
            patterns.push(self.parse_pattern()?);
            if !self.match_token(&[TokenType::Comma]) {
                break;
            }
        }
        self.consume(&TokenType::RParen, "Expected ')' after tuple pattern")?;
        if patterns.len() < 2 {
            return Err(Error::Parse {
                message: "tuple destructuring requires at least 2 bindings; for a single binding use 'let a = ...'".to_string(),
                line: self.previous().line,
            });
        }
        Ok(Pattern::Tuple(patterns))
    } else if self.check(&TokenType::LBrace) {
        self.advance(); // consume '{'
        let mut fields = Vec::new();
        loop {
            if self.check(&TokenType::RBrace) {
                break;
            }
            // Field name must be an identifier (not `_`)
            let field = self.peek().clone();
            if field.lexeme == "_" {
                return Err(Error::Parse {
                    message: "wildcard '_' is not valid as a map field name".to_string(),
                    line: field.line,
                });
            }
            let field_tok = self.consume(&TokenType::Identifier, "Expected field name in map pattern")?;
            // Optional rename: field: rename
            let rename = if self.match_token(&[TokenType::Colon]) {
                let rename_tok = self.peek().clone();
                if rename_tok.lexeme == "_" {
                    return Err(Error::Parse {
                        message: "wildcard '_' is not valid as a rename target".to_string(),
                        line: rename_tok.line,
                    });
                }
                Some(self.consume(&TokenType::Identifier, "Expected identifier as rename target")?)
            } else {
                None
            };
            fields.push((field_tok, rename));
            if !self.match_token(&[TokenType::Comma]) {
                break;
            }
        }
        self.consume(&TokenType::RBrace, "Expected '}' after map pattern")?;
        if fields.is_empty() {
            return Err(Error::Parse {
                message: "destructuring pattern must have at least one binding".to_string(),
                line: self.previous().line,
            });
        }
        Ok(Pattern::Map(fields))
    } else {
        let tok = self.consume(&TokenType::Identifier, "Expected variable name or pattern")?;
        if tok.lexeme == "_" {
            Ok(Pattern::Wildcard)
        } else {
            Ok(Pattern::Bind(tok))
        }
    }
}
```

- [ ] **Step 4: Update parse_var() to call parse_pattern()**

Replace the `let name = self.consume(&TokenType::Identifier, ...)` call in `parse_var()` with:

```rust
fn parse_var(&mut self, annotations: Vec<Expr>) -> Result<Stmt> {
    let keyword = self.advance(); // consume let or const
    let pattern = self.parse_pattern()?;
    // Type annotation only allowed on simple Bind patterns
    let type_annot = if self.match_token(&[TokenType::Colon]) {
        if !matches!(pattern, Pattern::Bind(_)) {
            return Err(Error::Parse {
                message: "type annotation not allowed on destructuring pattern".to_string(),
                line: self.previous().line,
            });
        }
        Some(self.parse_type()?)
    } else {
        None
    };
    let value = if self.match_token(&[TokenType::Assign]) {
        Some(self.parse_expression(Precedence::None)?)
    } else {
        None
    };
    if self.check(&TokenType::Semicolon) {
        self.advance();
    }
    if keyword.typ == TokenType::KwConst {
        Ok(Stmt::Const {
            pattern,
            type_annot,
            value: value.unwrap_or(Expr::Literal(Value::Null)),
        })
    } else {
        Ok(Stmt::Let {
            annotations,
            pattern,
            type_annot,
            value: value.unwrap_or(Expr::Literal(Value::Null)),
        })
    }
}
```

- [ ] **Step 5: Update parse_for() to call parse_pattern()**

```rust
fn parse_for(&mut self) -> Result<Stmt> {
    self.advance(); // consume 'for'
    let pattern = self.parse_pattern()?;
    self.consume(&TokenType::KwIn, "Expected 'in' after loop variable")?;
    let iterable = self.parse_expression(Precedence::None)?;
    let body = self.parse_block()?;
    Ok(Stmt::For {
        pattern,
        iterable,
        body: Box::new(body),
    })
}
```

- [ ] **Step 6: Run the tests**

```bash
cd /c/Users/justi/dev/quill && cargo test 2>&1 | tail -20
```

Expected: all tests pass including the new parse tests.

- [ ] **Step 7: Commit**

```bash
git add src/printing_press/inklang/parser.rs
git commit -m "feat(parser): add parse_pattern for tuple/map/wildcard destructuring"
```

---

## Chunk 3: Lowerer — lower_pattern()

### Task 3: Add lower_pattern() and update lowering for Let/Const/For

**Files:**
- Modify: `src/printing_press/inklang/lowerer.rs`

- [ ] **Step 1: Write failing tests for lower_pattern**

Add these tests to the `#[cfg(test)]` block at the bottom of `lowerer.rs`:

```rust
#[test]
fn test_lower_tuple_destructure() {
    let mut lowerer = AstLowerer::new();
    // let (a, b) = pair  →  a = pair[0], b = pair[1]
    let stmt = Stmt::Let {
        annotations: vec![],
        pattern: Pattern::Tuple(vec![
            Pattern::Bind(make_token(TokenType::Identifier, "a")),
            Pattern::Bind(make_token(TokenType::Identifier, "b")),
        ]),
        type_annot: None,
        value: Expr::Variable(make_token(TokenType::Identifier, "pair")),
    };
    lowerer.lower(&[stmt]);
    // Both a and b should be in locals
    assert!(lowerer.locals.contains_key("a"));
    assert!(lowerer.locals.contains_key("b"));
    // Should have emitted GetIndex instructions
    let get_index_count = lowerer.instrs.iter()
        .filter(|i| matches!(i, IrInstr::GetIndex { .. }))
        .count();
    assert_eq!(get_index_count, 2);
    // Should have emitted LoadImm for indices 0 and 1
    let load_imm_count = lowerer.instrs.iter()
        .filter(|i| matches!(i, IrInstr::LoadImm { .. }))
        .count();
    assert!(load_imm_count >= 2);
}

#[test]
fn test_lower_map_destructure() {
    let mut lowerer = AstLowerer::new();
    // let {name, health} = player
    let stmt = Stmt::Let {
        annotations: vec![],
        pattern: Pattern::Map(vec![
            (make_token(TokenType::Identifier, "name"), None),
            (make_token(TokenType::Identifier, "health"), None),
        ]),
        type_annot: None,
        value: Expr::Variable(make_token(TokenType::Identifier, "player")),
    };
    lowerer.lower(&[stmt]);
    assert!(lowerer.locals.contains_key("name"));
    assert!(lowerer.locals.contains_key("health"));
    let get_field_count = lowerer.instrs.iter()
        .filter(|i| matches!(i, IrInstr::GetField { .. }))
        .count();
    assert_eq!(get_field_count, 2);
}

#[test]
fn test_lower_map_destructure_with_rename() {
    let mut lowerer = AstLowerer::new();
    // let {name: n} = player  →  n = player.name
    let stmt = Stmt::Let {
        annotations: vec![],
        pattern: Pattern::Map(vec![
            (
                make_token(TokenType::Identifier, "name"),
                Some(make_token(TokenType::Identifier, "n")),
            ),
        ]),
        type_annot: None,
        value: Expr::Variable(make_token(TokenType::Identifier, "player")),
    };
    lowerer.lower(&[stmt]);
    // Bound under the rename "n", not "name"
    assert!(lowerer.locals.contains_key("n"));
    assert!(!lowerer.locals.contains_key("name"));
    // GetField should use "name" as the field name
    let has_name_field = lowerer.instrs.iter().any(|i| {
        matches!(i, IrInstr::GetField { name, .. } if name == "name")
    });
    assert!(has_name_field);
}

#[test]
fn test_lower_wildcard_in_tuple() {
    let mut lowerer = AstLowerer::new();
    // let (_, b) = pair  →  _ discarded, b = pair[1]
    let stmt = Stmt::Let {
        annotations: vec![],
        pattern: Pattern::Tuple(vec![
            Pattern::Wildcard,
            Pattern::Bind(make_token(TokenType::Identifier, "b")),
        ]),
        type_annot: None,
        value: Expr::Variable(make_token(TokenType::Identifier, "pair")),
    };
    lowerer.lower(&[stmt]);
    assert!(lowerer.locals.contains_key("b"));
    assert!(!lowerer.locals.contains_key("_"));
    // Still needs to emit GetIndex for both slots (to advance the index)
    let get_index_count = lowerer.instrs.iter()
        .filter(|i| matches!(i, IrInstr::GetIndex { .. }))
        .count();
    assert_eq!(get_index_count, 2);
}

#[test]
fn test_lower_nested_tuple() {
    let mut lowerer = AstLowerer::new();
    // let (a, (b, c)) = nested
    let stmt = Stmt::Let {
        annotations: vec![],
        pattern: Pattern::Tuple(vec![
            Pattern::Bind(make_token(TokenType::Identifier, "a")),
            Pattern::Tuple(vec![
                Pattern::Bind(make_token(TokenType::Identifier, "b")),
                Pattern::Bind(make_token(TokenType::Identifier, "c")),
            ]),
        ]),
        type_annot: None,
        value: Expr::Variable(make_token(TokenType::Identifier, "nested")),
    };
    lowerer.lower(&[stmt]);
    assert!(lowerer.locals.contains_key("a"));
    assert!(lowerer.locals.contains_key("b"));
    assert!(lowerer.locals.contains_key("c"));
}

#[test]
fn test_lower_tuple_duplicate_binding_error() {
    // let (a, a) = pair should panic with duplicate binding error
    let result = std::panic::catch_unwind(|| {
        let mut lowerer = AstLowerer::new();
        let stmt = Stmt::Let {
            annotations: vec![],
            pattern: Pattern::Tuple(vec![
                Pattern::Bind(make_token(TokenType::Identifier, "a")),
                Pattern::Bind(make_token(TokenType::Identifier, "a")),
            ]),
            type_annot: None,
            value: Expr::Literal(Value::Null),
        };
        lowerer.lower(&[stmt]);
    });
    assert!(result.is_err());
}
```

- [ ] **Step 2: Run the failing tests**

```bash
cd /c/Users/justi/dev/quill && cargo test lower_tuple_destructure lower_map_destructure lower_wildcard lower_nested lower_duplicate 2>&1 | tail -20
```

Expected: compile errors (Pattern not imported, lower_pattern doesn't exist).

- [ ] **Step 3: Add collect_bindings() helper**

Add this private helper to `AstLowerer` impl in `lowerer.rs`.

Key properties:
- **Recursive** — the Tuple arm recurses into each sub-pattern, so nested bindings are collected
- **Excludes Wildcard** — `Pattern::Wildcard => {}` is a no-op; wildcards produce no name
- **Map uses rename when present** — `rename.as_ref().unwrap_or(field)` works because iterating `&Vec<(Token, Option<Token>)>` yields `field: &Token` and `rename: &Option<Token>`; `.as_ref()` on `&Option<Token>` gives `Option<&Token>`; `unwrap_or(field)` is valid since `&Token: Copy`

```rust
/// Collect all Bind names from a pattern tree.
/// - Recursive: walks nested Tuple/Map.
/// - Excludes Wildcard: `_` produces no entry.
/// - Map uses rename name when present, field name otherwise.
fn collect_bindings<'a>(pattern: &'a Pattern, out: &mut Vec<&'a str>) {
    match pattern {
        Pattern::Bind(tok) => out.push(&tok.lexeme),
        Pattern::Wildcard => {}  // intentionally excluded
        Pattern::Tuple(pats) => {
            for p in pats {
                Self::collect_bindings(p, out);  // recursive
            }
        }
        Pattern::Map(fields) => {
            for (field, rename) in fields {
                // rename: &Option<Token>; .as_ref() → Option<&Token>; unwrap_or valid since &Token: Copy
                let name = rename.as_ref().unwrap_or(field);
                out.push(&name.lexeme);
            }
        }
    }
}

/// Check a pattern for duplicate bindings. Returns Err with the duplicate name.
fn check_duplicate_bindings(pattern: &Pattern) -> Result<(), String> {
    let mut names = Vec::new();
    Self::collect_bindings(pattern, &mut names);
    let mut seen = std::collections::HashSet::new();
    for name in names {
        if !seen.insert(name) {
            return Err(format!("duplicate binding '{}' in destructuring pattern", name));
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Add lower_pattern() method**

Add this method to `AstLowerer` impl:

```rust
/// Lower a pattern by binding from src_reg into locals.
/// src_reg already holds the value being destructured.
fn lower_pattern(&mut self, pattern: &Pattern, src_reg: usize) {
    match pattern {
        Pattern::Bind(tok) => {
            self.locals.insert(tok.lexeme.clone(), src_reg);
        }
        Pattern::Wildcard => {
            // Discard — no binding emitted
        }
        Pattern::Tuple(patterns) => {
            for (i, p) in patterns.iter().enumerate() {
                // Materialise integer index into a register via the constants table
                let const_idx = self.add_constant(Value::Int(i as i64));
                let int_reg = self.fresh_reg();
                self.emit(IrInstr::LoadImm { dst: int_reg, index: const_idx });
                let dst = self.fresh_reg();
                self.emit(IrInstr::GetIndex { dst, obj: src_reg, index: int_reg });
                self.lower_pattern(p, dst);
            }
        }
        Pattern::Map(fields) => {
            for (field, rename) in fields {
                // field: &Token, rename: &Option<Token> (iterating &Vec<(Token, Option<Token>)>)
                let dst = self.fresh_reg();
                self.emit(IrInstr::GetField {
                    dst,
                    obj: src_reg,
                    name: field.lexeme.clone(),
                });
                // rename.as_ref(): &Option<Token> → Option<&Token>
                // .unwrap_or(field): valid since &Token: Copy → &Token
                let binding_name = rename.as_ref().unwrap_or(field).lexeme.clone();
                self.locals.insert(binding_name, dst);
            }
        }
    }
}
```

- [ ] **Step 5: Add the Pattern import to lowerer.rs**

At the top of `lowerer.rs`, ensure `Pattern` is imported:

```rust
use super::ast::{Expr, Param, Pattern, Stmt};
```

- [ ] **Step 6: Run the tests (should pass now)**

```bash
cd /c/Users/justi/dev/quill && cargo test lower_tuple_destructure lower_map_destructure lower_wildcard lower_nested lower_duplicate 2>&1 | tail -20
```

Expected: all 6 new tests pass.

- [ ] **Step 7: Update lower_stmt for Stmt::Let**

Replace the temporary `panic!` stub from Task 1 with full pattern support:

```rust
Stmt::Let { pattern, value, .. } => {
    if let Pattern::Bind(name) = pattern {
        self.lower_var(name, Some(value));
    } else {
        // Destructuring pattern
        if let Err(msg) = Self::check_duplicate_bindings(pattern) {
            panic!("{}", msg);
        }
        let src = self.fresh_reg();
        self.lower_expr(value, src);
        self.lower_pattern(pattern, src);
    }
}
```

- [ ] **Step 8: Update lower_stmt for Stmt::Const**

```rust
Stmt::Const { pattern, value, .. } => {
    if let Pattern::Bind(name) = pattern {
        self.lower_var(name, Some(value));
        self.const_locals.insert(name.lexeme.clone());
    } else {
        if let Err(msg) = Self::check_duplicate_bindings(pattern) {
            panic!("{}", msg);
        }
        let src = self.fresh_reg();
        self.lower_expr(value, src);
        // lower_pattern inserts each name into locals
        self.lower_pattern(pattern, src);
        // Mark all bound names as const
        let mut names = Vec::new();
        Self::collect_bindings(pattern, &mut names);
        for name in names {
            self.const_locals.insert(name.to_string());
        }
    }
}
```

- [ ] **Step 9: Update lower_for for pattern support**

The current `lower_for` takes `&Token`. Change the `Stmt::For` match in `lower_stmt` to handle patterns, and add a `lower_for_pattern` helper, or inline the pattern binding.

In `lower_stmt`, replace the current For dispatch:

```rust
Stmt::For { pattern, iterable, body } => {
    self.lower_for_with_pattern(pattern, iterable, body);
}
```

Add the new method (adapting existing `lower_for`):

```rust
fn lower_for_with_pattern(&mut self, pattern: &Pattern, iterable: &Expr, body: &Stmt) {
    let top_label = self.fresh_label();
    let end_label = self.fresh_label();
    let prev_break = self.break_label.take();
    let prev_next = self.next_label.take();
    self.break_label = Some(end_label);
    self.next_label = Some(top_label);

    // Evaluate iterable and call .iter()
    let iterable_reg = self.fresh_reg();
    self.lower_expr(iterable, iterable_reg);

    let iter_reg = self.fresh_reg();
    self.emit(IrInstr::GetField {
        dst: iter_reg,
        obj: iterable_reg,
        name: "iter".to_string(),
    });
    self.emit(IrInstr::Call { dst: iter_reg, func: iter_reg, args: vec![] });
    self.locals.insert("__iter".to_string(), iter_reg);

    self.emit(IrInstr::Label { label: top_label });
    let cond_reg = self.fresh_reg();
    self.emit(IrInstr::GetField {
        dst: cond_reg,
        obj: iter_reg,
        name: "hasNext".to_string(),
    });
    self.emit(IrInstr::Call { dst: cond_reg, func: cond_reg, args: vec![] });
    self.emit(IrInstr::JumpIfFalse { src: cond_reg, target: end_label });

    // Call iter.next() into value_reg
    let value_reg = self.fresh_reg();
    self.emit(IrInstr::GetField {
        dst: value_reg,
        obj: iter_reg,
        name: "next".to_string(),
    });
    self.emit(IrInstr::Call { dst: value_reg, func: value_reg, args: vec![] });

    // Bind the iteration value via the pattern
    if let Pattern::Bind(tok) = pattern {
        self.locals.insert(tok.lexeme.clone(), value_reg);
    } else {
        if let Err(msg) = Self::check_duplicate_bindings(pattern) {
            panic!("{}", msg);
        }
        self.lower_pattern(pattern, value_reg);
    }

    self.lower_stmt(body);

    self.emit(IrInstr::Jump { target: top_label });
    self.emit(IrInstr::Label { label: end_label });

    // Remove bindings introduced by the pattern (matching existing lower_for behavior)
    let mut names = Vec::new();
    Self::collect_bindings(pattern, &mut names);
    for name in names {
        self.locals.remove(name);
    }
    self.locals.remove("__iter");

    self.break_label = prev_break;
    self.next_label = prev_next;
}
```

Keep the old `lower_for` method in place (it's still called by the simple Bind path). Or remove it if you've replaced all call sites.

- [ ] **Step 10: Write a test for the full pipeline (parser → lowerer)**

Add to `lowerer.rs` tests:

```rust
#[test]
fn test_lower_parsed_tuple_destructure() {
    // Parse source text and lower — end-to-end through both layers
    use crate::printing_press::inklang::parser::Parser;
    let stmts = Parser::new_from_source("let (a, b) = pair").parse().unwrap();
    let mut lowerer = AstLowerer::new();
    // Seed 'pair' as a known local so lower_expr doesn't emit LoadGlobal for it
    let pair_reg = lowerer.fresh_reg();
    lowerer.locals.insert("pair".to_string(), pair_reg);
    lowerer.lower(&stmts);
    assert!(lowerer.locals.contains_key("a"));
    assert!(lowerer.locals.contains_key("b"));
}
```

- [ ] **Step 11: Run all tests**

```bash
cd /c/Users/justi/dev/quill && cargo test 2>&1 | tail -20
```

Expected: all tests pass, no failures.

- [ ] **Step 12: Commit**

```bash
git add src/printing_press/inklang/lowerer.rs
git commit -m "feat(lowerer): add lower_pattern for tuple/map/wildcard destructuring"
```
