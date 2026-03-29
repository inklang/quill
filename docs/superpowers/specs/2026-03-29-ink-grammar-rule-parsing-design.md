# Ink Grammar Rule Parsing in Rust — Design

**Date:** 2026-03-29
**Status:** Design approved; pending implementation

---

## 1. Overview

**Goal:** Replace the TypeScript `@inklang/quill/grammar` toolchain with a native Rust grammar parser that produces `MergedGrammar`-compatible JSON consumable by `printing_press`. quill authors grammars end-to-end without requiring Node.js.

**Scope:** Port rule definition parsing to Rust. Keyword declarations already exist in `GrammarParser`. This spec covers the full rule grammar and bridging to `MergedGrammar`.

---

## 2. Grammar Syntax

### 2.1 Package Declaration

```
grammar <name>
```

Example:
```
grammar mygame
```

### 2.2 Import

```
using <package>
```

Example:
```
using base_engine
using physics
```

### 2.3 Keyword Declaration

```
keyword <name> = "<value>" | "<value1>" | "<value2>"
```

Example:
```
keyword direction = "north" | "south" | "east" | "west"
keyword move = "move"
```

### 2.4 Rule Definition

```
rule <name> [inherits <base>] [-> <pattern>] [handler(<handler>)]?
```

Or with a block body:

```
rule <name> [inherits <base>] {
    pattern = <pattern>
    handler = "<handler>"
}
```

Example (inline):
```
rule player_move -> "move" identifier integer integer
```

Example (block):
```
rule on_click inherits on_event {
    pattern = "click" identifier
    handler = "handle_click"
}
```

### 2.5 Pattern Grammar (EBNF-inspired)

```
pattern     := seq ("|" seq)*
seq         := term+
term        := unit | unit "?" | unit "*" | unit "+"
unit        := literal | identifier | keyword_ref | "(" pattern ")" | "[" pattern "]"
literal     := '"' string_char+ '"'
identifier  := 'identifier'
keyword_ref := '$' keyword_name
```

- **Whitespace-separated** = sequence (no explicit `seq()`)
- **`|`** = choice
- **`?`** = optional
- **`*`** = zero or more
- **`+`** = one or more
- **`$keyword`** = reference to a declared keyword
- **`"..."`** = literal string match
- **`identifier`** = built-in token (matches Ink identifiers)
- **`integer`** = built-in token (matches `[0-9]+`)
- **`float`** = built-in token (matches `[0-9]+\.[0-9]+`)
- **`string`** = built-in token (matches `"..."`)

### 2.6 Inheritance

A rule can inherit from a base rule. The base rule's pattern is expanded first, then the child's pattern is appended or modified.

```
rule on_event -> entity
rule on_click inherits on_event -> "click" identifier
```

### 2.7 Handler

Handler names are strings that map to Ink event handler functions. They are declared inline with the rule or in a trailing block.

```
rule attack -> entity "attacks" entity handler("handle_attack")
```

---

## 3. Grammar IR → MergedGrammar Bridging

### 3.1 Two-Tier Architecture

```
ink-grammar file
    │
    ▼
GrammarParser (Rust) → GrammarIr
    │                      │
    │  (new: serialize)     │ (existing: merge keywords)
    ▼                      ▼
MergedGrammar JSON ────► printing_press::inklang::grammar::load_grammar()
```

The `MergedGrammar` JSON format is defined by `printing_press/src/inklang/grammar.rs` and matches the TypeScript `defineGrammar` output:

```json
{
  "package": "mygame",
  "keywords": [
    { "name": "move", "values": ["move"] },
    { "name": "direction", "values": ["north", "south", "east", "west"] }
  ],
  "rules": [
    {
      "name": "player_move",
      "pattern": {
        "type": "Seq",
        "items": [
          { "type": "Ref", "name": "move" },
          { "type": "Identifier" },
          { "type": "Int" },
          { "type": "Int" }
        ]
      }
    }
  ],
  "declarations": [
    {
      "name": "on_click",
      "inherits": "on_event",
      "pattern": {
        "type": "Seq",
        "items": [
          { "type": "Literal", "value": "click" },
          { "type": "Identifier" }
        ]
      },
      "handler": "handle_click"
    }
  ]
}
```

### 3.2 GrammarIr Changes

The existing `GrammarIr` struct in `quill/src/grammar/mod.rs` will be extended:

```rust
pub struct GrammarIr {
    pub package: String,
    pub rules: BTreeMap<String, RuleDef>,   // NEW: was always empty
    pub keywords: BTreeMap<String, KeywordDef>,
    pub imports: Vec<String>,
}

pub struct RuleDef {
    pub name: String,
    pub inherits: Option<String>,
    pub pattern: Pattern,
    pub handler: Option<String>,
}
```

`Pattern` already exists and covers the full pattern algebra (Sequence, Choice, Repeat, Optional, Literal, Ident, etc.).

### 3.3 Serialization to MergedGrammar JSON

A new `GrammarSerializer::serialize_merged(rules: &[RuleDef], keywords: &BTreeMap<String, KeywordDef>) -> MergedGrammar` function converts `GrammarIr` → printing_press's `MergedGrammar` struct.

The `MergedGrammar` struct lives in `quill/src/printing_press/inklang/grammar.rs` (copied from printing_press source). We serialize to its JSON form for consumption by printing_press's parser.

### 3.4 Pattern Mapping

| GrammarIr Pattern | MergedGrammar Rule |
|---|---|
| `Pattern::Literal(s)` | `Rule::Literal { value: s }` |
| `Pattern::Ident` | `Rule::Identifier` |
| `Pattern::Int` | `Rule::Int` |
| `Pattern::Float` | `Rule::Float` |
| `Pattern::String` | `Rule::String` |
| `Pattern::Block(v)` | `Rule::Block { scope: vec![...] }` |
| `Pattern::Choice(v)` | `Rule::Choice { items: vec![...] }` |
| `Pattern::Sequence(v)` | `Rule::Seq { items: vec![...] }` |
| `Pattern::Repeat(p)` | `Rule::Many { item: Box::new(...) }` |
| `Pattern::Optional(p)` | `Rule::Optional { item: Box::new(...) }` |
| `Pattern::Keyword(name)` | `Rule::Keyword { value: name }` |

---

## 4. GrammarParser Changes

### 4.1 New Methods

Add to `GrammarParser` in `quill/src/grammar/parser.rs`:

- `parse_rule_def() -> Result<RuleDef>` — parses `rule <name> [inherits <base>] [-> <pattern>] [handler(...)]?`
- `parse_pattern() -> Result<Pattern>` — recursive descent for the EBNF grammar above
- `parse_seq() -> Result<Pattern>` — parses a sequence of terms
- `parse_choice() -> Result<Pattern>` — parses `term | term | ...`
- `parse_term() -> Result<Pattern>` — handles `unit ?`, `unit *`, `unit +`
- `parse_unit() -> Result<Pattern>` — handles literals, identifiers, $keywords, grouping

### 4.2 GrammarIr::rules Populated

`GrammarParser::parse()` will collect `rule <name>` entries into `GrammarIr.rules`. Previously this was always empty because rule parsing was not implemented.

### 4.3 Error Handling

Parser errors return `GrammarParseError` (new error variant in `quill/src/error.rs`):

```rust
pub enum QuillError {
    // ...
    GrammarParse {
        message: String,
        line: usize,
        column: usize,
    },
}
```

---

## 5. Build Pipeline Changes

### 5.1 `build.rs` Flow

```
1. Parse local grammar.ink-grammar → GrammarIr (with rules populated)
2. Load dependency grammars from node_modules/<pkg>/grammar.ink-grammar
3. Merge GrammarIrs → single GrammarIr
4. Serialize GrammarIr → MergedGrammar JSON
5. Pass MergedGrammar to printing_press::compile_with_grammar()
```

### 5.2 compile_with_grammar

`printing_press::compile_with_grammar(source: &str, name: &str, grammar: &MergedGrammar) -> Result<SerialScript, CompileError>` — new function that takes an explicit grammar instead of auto-discovering it.

Add to `quill/src/printing_press/mod.rs`:

```rust
pub fn compile_with_grammar(source: &str, name: &str, grammar: &inklang::grammar::MergedGrammar) -> Result<SerialScript, CompileError> {
    inklang::compile_with_grammar(source, name, grammar)
}
```

Note: `compile()` in printing_press already auto-discovers grammars. `compile_with_grammar()` bypasses that and accepts a provided `MergedGrammar`.

---

## 6. File Map

### New files
- `quill/src/grammar/serialize.rs` — GrammarIr → MergedGrammar serialization
- `quill/tests/grammar_tests.rs` — round-trip tests for grammar parsing

### Modified files
- `quill/src/grammar/mod.rs` — add `RuleDef` struct, extend `GrammarIr`
- `quill/src/grammar/parser.rs` — add rule parsing methods, populate `GrammarIr.rules`
- `quill/src/error.rs` — add `GrammarParse` error variant
- `quill/src/printing_press/mod.rs` — add `compile_with_grammar` re-export
- `quill/src/printing_press/inklang/grammar.rs` — already copied; ensure `MergedGrammar` fields match
- `quill/src/commands/build.rs` — use `compile_with_grammar` with serialized grammar

---

## 7. Testing Strategy

### 7.1 Parser Unit Tests
- Parse valid rule definitions and verify `GrammarIr.rules` populated correctly
- Parse valid patterns (sequence, choice, optional, repeat, literal, keyword ref, identifier)
- Parse inheritance chains
- Parse handlers

### 7.2 Round-Trip Tests
- Parse a `.ink-grammar` file → `GrammarIr` → serialize to JSON → compare JSON structure against expected `MergedGrammar`

### 7.3 Build Integration Test
- Run `quill build` on a fixture package with a `grammar.ink-grammar` and verify the output `ink-manifest.json` contains the correct merged grammar IR

---

## 8. Out of Scope (Future Work)

- Migrating existing TypeScript `grammar.ir.json` files to new format (clean break — no backward compat)
- The `declare keyword` vs `keyword` distinction in the new syntax (clean break, only `keyword` syntax)
- Handler invocation syntax beyond string names (future extension point)
- Grammar validation (e.g., detecting unused keywords, circular inheritance) — not needed for MVP
