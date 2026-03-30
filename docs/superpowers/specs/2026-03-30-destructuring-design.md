# Destructuring Design

**Date:** 2026-03-30
**Status:** Approved

---

## Problem

Ink has no way to bind multiple values from a tuple, list, or map in a single statement. Users must write verbose index/field access chains:

```ink
let x = pair[0]
let y = pair[1]
let name = player.name
let health = player.health
```

This is especially noisy in `for` loops over structured data.

---

## Solution

Add a first-class `Pattern` enum to the AST. Destructuring patterns are supported in `let`, `const`, and `for` loop variable positions. All patterns desugar to existing `GetIndex` and `GetField` IR instructions — no VM or codegen changes required.

---

## Syntax

### Tuple/list destructuring

Uses `()`. Works with any indexable value (tuples, lists, arrays).

```ink
let (a, b) = pair
let (x, y, _) = triple
let (head, _, tail) = three_tuple
```

### Map/object destructuring

Uses `{}`. Field names must match properties on the value. Rename with `:`.

```ink
let {name, health} = player
let {name: n, health: hp} = player
```

### Wildcard

`_` discards a slot. Valid in tuple patterns only (not as a map field name).

```ink
let (_, important) = pair
```

### For loops

The loop variable accepts any pattern.

```ink
for (x, y) in points { ... }
for {name, score} in leaderboard { ... }
```

### Nested patterns

Patterns are recursive. Nesting works at any depth.

```ink
let (a, (b, c)) = nested
```

### `const` destructuring

`const` follows the same rules as `let`.

```ink
const (WIDTH, HEIGHT) = dimensions
```

---

## Architecture

### `ast.rs` — new `Pattern` enum

```rust
pub enum Pattern {
    Bind(Token),                       // x
    Wildcard,                          // _
    Tuple(Vec<Pattern>),               // (a, b, c)
    Map(Vec<(Token, Option<Token>)>),  // {field} or {field: rename}
}
```

`Stmt::Let`, `Stmt::Const`, and `Stmt::For` replace their `name: Token` / `variable: Token` field with `pattern: Pattern`. The `Bind` variant covers all existing single-name usage, so no behavior changes for non-destructuring code.

### `parser.rs` — `parse_pattern()`

New method dispatches on the next token:

| Token | Result |
|-------|--------|
| `(` | Parse comma-separated patterns until `)` → `Pattern::Tuple` |
| `{` | Parse `field` or `field: rename` entries until `}` → `Pattern::Map` |
| `_` | `Pattern::Wildcard` |
| identifier | `Pattern::Bind(token)` |

Called from `parse_let()`, `parse_const()`, and `parse_for()` in place of consuming a plain identifier.

Map entry parsing:
- `{name}` → field `name`, no rename
- `{name: n}` → field `name`, rename to `n`
- Multiple entries separated by `,`

### `lowerer.rs` — `lower_pattern(pattern, src_reg)`

Recursive method. Evaluates the RHS into `src_reg` once, then walks the pattern:

| Pattern | Emits |
|---------|-------|
| `Bind(tok)` | `locals.insert(tok.lexeme, src_reg)` |
| `Wildcard` | no-op |
| `Tuple(patterns)` | For each `(i, p)`: `GetIndex(dst, src_reg, i)` → recurse `lower_pattern(p, dst)` |
| `Map(fields)` | For each `(field, rename)`: `GetField(dst, src_reg, field.lexeme)` → recurse `lower_pattern(Bind(rename ?? field), dst)` |

`lower_let`, `lower_const`, and `lower_for` evaluate their RHS expression into a temp register, then call `lower_pattern(pattern, temp)`.

### No IR / codegen / VM changes

All destructuring desugars to existing `GetIndex` and `GetField` instructions. No new opcodes, no serialization changes.

---

## Error Handling

### Compile-time

| Error | Message |
|-------|---------|
| Empty pattern `()` or `{}` | `"destructuring pattern must have at least one binding"` |
| Duplicate binding in pattern `(a, a)` | `"duplicate binding 'a' in destructuring pattern"` |
| `_` as map field name `{_}` | `"wildcard '_' is not valid as a map field name"` |

### Runtime

Runtime errors fall through to existing VM exceptions — no special destructuring messages:

- Tuple index out of bounds → existing `ScriptException` from `GET_INDEX` (same as `pair[2]` today)
- Missing map field → existing `ScriptException` from `GET_FIELD` (same as `obj.nonexistent` today)

---

## Scope

### In scope

- `let` / `const` / `for` destructuring
- Tuple patterns `(a, b, c)`
- Map patterns `{field}` and `{field: rename}`
- Wildcard `_` in tuple patterns
- Nested patterns (recursive, comes for free)

### Out of scope

- Function parameter destructuring (touches arity, call-site semantics, named args)
- Default values: `let {x, y = 0} = obj`
- Rest patterns: `let (head, ...tail) = list`
- `match` expressions (separate feature; the `Pattern` enum will be reused when that lands)

---

## Files Changed

| File | Change |
|------|--------|
| `src/printing_press/inklang/ast.rs` | Add `Pattern` enum; update `Stmt::Let`, `Stmt::Const`, `Stmt::For` |
| `src/printing_press/inklang/parser.rs` | Add `parse_pattern()`; update `parse_let`, `parse_const`, `parse_for` |
| `src/printing_press/inklang/lowerer.rs` | Add `lower_pattern()`; update `lower_let`, `lower_const`, `lower_for` |
