# Ink Grammar Rule Parsing in Rust — Design

**Date:** 2026-03-29
**Status:** Design approved (spec review fixes applied)

---

## 1. Overview

**Goal:** Replace the TypeScript `@inklang/quill/grammar` toolchain with a native Rust grammar parser that produces `MergedGrammar`-compatible JSON consumable by `printing_press`. quill authors grammars end-to-end without requiring Node.js.

**Scope:** Port rule definition parsing to Rust. This is a complete parser rewrite — the existing `GrammarParser` syntax (`declare keyword inherits base { rule_name = pattern; }`) is replaced entirely. Keyword declarations and rule definitions both get new syntax.

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
- **`identifier`** = built-in token (matches Ink identifiers) — the parser recognizes the word `identifier`
- **`int`** = built-in token (matches `[0-9]+`) — the parser recognizes the word `int`
- **`float`** = built-in token (matches `[0-9]+\.[0-9]+`) — the parser recognizes the word `float`
- **`string`** = built-in token (matches `"..."`) — the parser recognizes the word `string`

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
    pub inherits: Vec<String>,              // NOTE: existing GrammarRule uses Vec<String>; first element is the primary base
    pub pattern: Pattern,
    pub handler: Option<String>,
}
```

`Pattern` already exists and covers the full pattern algebra (Sequence, Choice, Repeat, Optional, Literal, Ident, Int, Float, String, Block, Keyword). A new `Pattern::Ref(String)` variant is added for `$keyword` references — see Section 3.4.

### 3.3 Serialization to MergedGrammar JSON

A new `GrammarSerializer::serialize_merged(rules: &[RuleDef], keywords: &BTreeMap<String, KeywordDef>) -> MergedGrammar` function converts `GrammarIr` → printing_press's `MergedGrammar` struct.

The `MergedGrammar` struct lives in `quill/src/printing_press/inklang/grammar.rs` (copied from printing_press source). We serialize to its JSON form for consumption by printing_press's parser.

### 3.4 Pattern Mapping

**Important corrections from codebase review:**

- `Rule::Block { scope: Option<String> }` is for **scoping** (block-level variable visibility), NOT grouping. `Pattern::Block` (grouping) maps to `Rule::Seq` instead.
- `*` (zero-or-more) maps to `Rule::Many`; `+` (one-or-more) maps to `Rule::Many1` — these are distinct in printing_press.
- A new `Pattern::Ref(String)` variant is added for `$keyword` references (rule references, not inlined keywords).

| GrammarIr Pattern | MergedGrammar Rule |
|---|---|
| `Pattern::Literal(s)` | `Rule::Literal { value: s }` |
| `Pattern::Ident` | `Rule::Identifier` |
| `Pattern::Int` | `Rule::Int` |
| `Pattern::Float` | `Rule::Float` |
| `Pattern::String` | `Rule::String` |
| `Pattern::Block(items)` | `Rule::Seq { items: mapped_items }` — grouping, NOT `Rule::Block` |
| `Pattern::Choice(v)` | `Rule::Choice { items: vec![...] }` |
| `Pattern::Sequence(v)` | `Rule::Seq { items: vec![...] }` |
| `Pattern::Repeat(p)` | `Rule::Many { item: Box::new(...) }` — maps to `*` (zero-or-more) |
| `Pattern::Repeat1(p)` **(new)** | `Rule::Many1 { item: Box::new(...) }` — maps to `+` (one-or-more) |
| `Pattern::Optional(p)` | `Rule::Optional { item: Box::new(...) }` |
| `Pattern::Keyword(value)` | `Rule::Keyword { value }` — inlined keyword match |
| `Pattern::Ref(name)` **(new)** | `Rule::Ref { rule: name }` — reference to a declared keyword |

### 3.5 RuleDef → GrammarPackage Output Mapping

Rules in `GrammarPackage` go into two distinct arrays based on their purpose:

**`rules: HashMap<String, RuleEntry>`** — general parsing rules:
```json
"rules": {
  "player_move": { "rule": { "type": "seq", "items": [...] }, "handler": "handleMove" }
}
```

**`declarations: Vec<DeclarationDef>`** — event/handler declarations with inheritance:
```json
"declarations": [{
  "keyword": "on_click",
  "nameRule": { "type": "identifier" },
  "scopeRules": [],
  "inheritsBase": true,
  "handler": "handleClick"
}]
```

Mapping from `RuleDef` to output:
- `RuleDef.inherits.is_empty()` → add to `rules` as `RuleEntry { rule: pattern_mapped, handler }`
- `RuleDef.inherits.non_empty()` → add to `declarations` as `DeclarationDef { keyword: name, nameRule: mapped_pattern, scopeRules: [], inheritsBase: true, handler }`

Note: `DeclarationDef.nameRule` is the **name-matching pattern** (typically `Identifier`), not the full pattern. The full pattern belongs in the `rules` map. This is a known complexity — the TypeScript schema uses `nameRule` for the declaration name pattern and `scopeRules` for additional scope绑定. For MVP, `scopeRules` defaults to `[]`.

### 3.6 GrammarPackage JSON Output

The serializer produces a `GrammarPackage`-compatible JSON file at `dist/grammar.ir.json`:

```json
{
  "version": 1,
  "package": "mygame",
  "keywords": ["move", "direction", "north", "south", "east", "west"],
  "rules": {
    "player_move": { "rule": { "type": "seq", "items": [...] }, "handler": "handleMove" }
  },
  "declarations": []
}
```

This file is then loaded by `printing_press::grammar::load_grammar()` and merged via `merge_grammars()`.

---

## 4. GrammarParser Changes

**This is a complete parser rewrite.** The existing `parse()` loop (which handles `grammar`, `using`, `declare keyword`) is replaced with a new loop that handles the new syntax (`grammar`, `using`, `keyword`, `rule`).

### 4.1 New `parse()` Loop

```rust
pub fn parse(&mut self) -> Result<GrammarIr> {
    let package = self.parse_grammar_decl()?;  // "grammar <name>"
    let mut imports = Vec::new();
    let mut keywords = BTreeMap::new();
    let mut rules = BTreeMap::new();

    loop {
        self.skip_whitespace_and_comments();
        if self.is_at_end() { break; }

        match self.peek_word().as_deref() {
            Some("using")   => imports.push(self.parse_using()?),
            Some("keyword") => { let k = self.parse_keyword_decl()?; keywords.insert(k.name.clone(), k); }
            Some("rule")    => { let r = self.parse_rule_def()?; rules.insert(r.name.clone(), r); }
            Some("grammar") => return Err(self.error("grammar declaration must be at the top")),
            _               => return Err(self.error(&format!("unexpected token at {}:{}", self.line, self.col))),
        }
    }

    Ok(GrammarIr { package, rules, keywords, imports })
}
```

### 4.2 New Parsing Methods

- `parse_grammar_decl() -> Result<String>` — parses `grammar <name>` (no semicolon in new syntax)
- `parse_using() -> Result<String>` — parses `using <package>`
- `parse_keyword_decl() -> Result<KeywordDef>` — parses `keyword <name> = "<v1>" | "<v2>"`
- `parse_rule_def() -> Result<GrammarRule>` — parses `rule <name> [inherits <base>] -> <pattern> [handler(...)]?`
- `parse_pattern() -> Result<Pattern>` — entry point for pattern parsing (calls `parse_choice`)
- `parse_seq() -> Result<Pattern>` — parses a sequence of terms (whitespace-separated)
- `parse_choice() -> Result<Pattern>` — parses `term | term | ...`
- `parse_term() -> Result<Pattern>` — handles `unit ?`, `unit *`, `unit +`
- `parse_unit() -> Result<Pattern>` — handles literals, `$keyword`, built-in tokens (`identifier`, `int`, `float`, `string`), grouping (`(...)`)

### 4.3 GrammarIr::rules Populated

`GrammarParser::parse()` will collect `rule <name>` entries into `GrammarIr.rules`. Previously this was always empty because rule parsing was not implemented.

### 4.4 Error Handling

`GrammarParse` error variant already exists at `parser.rs:486-491`. The `error()` method already produces `{ path, message, line, col }` — no changes needed.

---

## 5. Build Pipeline Changes

### 5.1 `build.rs` Flow

```
1. Parse local grammar.ink-grammar → GrammarIr (with rules populated)
2. Load dependency grammars from node_modules/<pkg>/grammar.ink-grammar
3. Merge GrammarIrs → single GrammarIr
4. Serialize GrammarIr → GrammarPackage JSON → write to dist/grammar.ir.json
5. Call printing_press::compile_with_grammar(source, name, Some(&merged_grammar))
```

### 5.2 compile_with_grammar (already exists)

`printing_press::compile_with_grammar(source: &str, name: &str, grammar: Option<&MergedGrammar>)` already exists at `inklang/mod.rs:137`. Pass `Some(&merged_grammar)` to use the serialized grammar instead of auto-discovery.

The `compile()` function (which auto-discovers) is NOT used in the new pipeline — `compile_with_grammar()` with an explicit grammar is used instead.

---

## 6. File Map

### New files
- `quill/tests/grammar_tests.rs` — round-trip tests for grammar parsing

### Modified files
- `quill/src/grammar/mod.rs` — add `Pattern::Ref`, `Pattern::Repeat1` variants; `RuleDef` already exists as `GrammarRule`
- `quill/src/grammar/parser.rs` — **complete rewrite** of the rule parsing section; new syntax replaces old `declare keyword` syntax entirely
- `quill/src/grammar/serializer.rs` — add `serialize_grammar_package()` method that produces `GrammarPackage`-compatible JSON
- `quill/src/commands/build.rs` — serialize GrammarIr to `dist/grammar.ir.json`, then call `compile_with_grammar()` (already exists in printing_press)

### No changes needed
- `quill/src/error.rs` — `GrammarParse` error variant already exists (line 486-491 of parser.rs uses it)
- `quill/src/printing_press/mod.rs` — `compile_with_grammar()` already exists at inklang/mod.rs:137

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
