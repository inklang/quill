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

Add a first-class `Pattern` enum to the AST. Destructuring patterns are supported in `let`, `const`, and `for` loop variable positions. All patterns desugar to existing `GetField` IR instructions and `LoadImm` + `GetIndex` IR instruction pairs — no VM or codegen changes required.

---

## Syntax

### Tuple/list destructuring

Uses `()`. Works with any indexable value (tuples, lists, arrays). Must contain 2 or more bindings — `(a)` is a parse error.

```ink
let (a, b) = pair
let (x, y, _) = triple
let (head, _, tail) = three_tuple
```

### Map/object destructuring

Uses `{}`. Field names must match properties on the value. Rename with `:`. Must contain at least one entry.

```ink
let {name, health} = player
let {name: n, health: hp} = player
```

### Wildcard

`_` discards a slot. Valid in tuple patterns only — not as a map field name (`{_}` is a parse error) and not as a map rename target (`{name: _}` is a parse error).

```ink
let (_, important) = pair
```

### For loops

The loop variable accepts any pattern. Pattern bindings follow the same scoping as the existing loop variable: they are inserted into the enclosing scope (matching current `lower_for` behavior, which does not remove the loop variable after the loop).

```ink
for (x, y) in points { ... }
for {name, score} in leaderboard { ... }
```

### Nested patterns

Patterns are recursive. Nesting works at any depth. Duplicate binding detection is global across the entire pattern tree.

```ink
let (a, (b, c)) = nested
```

### `const` destructuring

`const` follows the same rules as `let`.

```ink
const (WIDTH, HEIGHT) = dimensions
```

### Type annotations and statement annotations

`type_annot` is forbidden on non-`Bind` patterns — `let (a, b): Tuple = x` is a parse error with message `"type annotation not allowed on destructuring pattern"`. Type annotations remain valid on simple bindings: `let x: Int = 5`.

Statement-level `annotations` (e.g. `@deprecated let (a, b) = x`) are permitted on any `let` pattern — annotations attach to the statement, not the binding.

---

## Architecture

### `ast.rs` — new `Pattern` enum

```rust
pub enum Pattern {
    Bind(Token),                       // x
    Wildcard,                          // _
    Tuple(Vec<Pattern>),               // (a, b, c)
    Map(Vec<(Token, Option<Token>)>),  // (field_name, rename_target)
                                       // {field} → (field, None)
                                       // {field: rename} → (field, Some(rename))
}
```

`Stmt::Let`, `Stmt::Const`, and `Stmt::For` replace their `name: Token` / `variable: Token` field with `pattern: Pattern`. The `Bind` variant covers all existing single-name usage, so no behavior changes for non-destructuring code.

`Stmt::Let` retains `type_annot: Option<Token>` and `annotations: Vec<Expr>`. The parser emits a parse error if `type_annot` is present and the pattern is not `Bind`.

### `parser.rs` — `parse_pattern()`

New method dispatches on the next token:

| Token | Result |
|-------|--------|
| `(` | Parse comma-separated patterns until `)` → `Pattern::Tuple` |
| `{` | Parse field entries until `}` → `Pattern::Map` |
| `_` | `Pattern::Wildcard` |
| identifier | `Pattern::Bind(token)` |

Called from `parse_let()`, `parse_const()`, and `parse_for()` in place of consuming a plain identifier.

**Tuple parsing:** After consuming `(`, parse patterns separated by `,`, then consume `)`. Emit a parse error if zero or one pattern is present (must have ≥ 2). The empty check applies at every nesting level — `(())` is a parse error because the inner `()` is empty.

**Map entry parsing:**
- `{name}` → `(name_token, None)`
- `{name: rename}` → `(name_token, Some(rename_token))`
- Field name must be an identifier token — `{_}` is a parse error.
- Rename target must be an identifier token — `{name: _}` and `{name: 42}` are parse errors.
- Multiple entries separated by `,`.

**Single-element tuple disambiguation:** `(a)` is a parse error ("tuple destructuring requires at least 2 bindings; for a single binding use `let a = ...`"). This avoids ambiguity with parenthesised expressions.

### `lowerer.rs` — `lower_pattern(pattern, src_reg)`

Recursive method. The RHS is evaluated into `src_reg` once by the caller before `lower_pattern` is invoked.

**Duplicate binding detection:** The caller collects all `Bind` names from the full pattern tree before lowering and errors on any duplicate: `"duplicate binding 'a' in destructuring pattern"`.

| Pattern | Emits |
|---------|-------|
| `Bind(tok)` | `locals.insert(tok.lexeme, src_reg)` |
| `Wildcard` | no-op |
| `Tuple(patterns)` | For each `(i, p)`: `const_idx = add_constant(Value::Int(i))`; `int_reg = fresh_reg()`; emit `LoadImm { dst: int_reg, index: const_idx }`; `dst = fresh_reg()`; emit `GetIndex { dst, obj: src_reg, index: int_reg }`; recurse `lower_pattern(p, dst)` |
| `Map(fields)` | For each `(field, rename)`: allocate `dst = fresh_reg()`; emit `GetField { dst, obj: src_reg, name: field.lexeme }`; call `locals.insert(rename.unwrap_or(field).lexeme, dst)` directly (leaf — no recursion needed since rename is always a plain identifier) |

`lower_let`, `lower_const`, and `lower_for` each evaluate their RHS expression into a temp register, then call `lower_pattern(pattern, temp)`.

**Note:** Each element in `Tuple` lowering allocates its own `int_reg` and `dst` via `fresh_reg()`. Registers are never shared across iterations.

### No IR / codegen / VM changes

All destructuring desugars to existing `LoadImm`, `GetIndex`, and `GetField` instructions. `GetIndex.index` is a register, so integer indices are materialized with `LoadImm` before each `GetIndex` call. No new opcodes or serialization changes.

---

## Error Handling

### Compile-time

| Error | Message |
|-------|---------|
| Empty tuple pattern `()` | `"destructuring pattern must have at least one binding"` |
| Empty map pattern `{}` | `"destructuring pattern must have at least one binding"` |
| Single-element tuple `(a)` | `"tuple destructuring requires at least 2 bindings; for a single binding use 'let a = ...'"` |
| Duplicate binding `(a, a)` or `(a, (a, b))` | `"duplicate binding 'a' in destructuring pattern"` |
| Wildcard as map field `{_}` | `"wildcard '_' is not valid as a map field name"` |
| Wildcard as rename target `{name: _}` | `"wildcard '_' is not valid as a rename target"` |
| Type annotation on destructuring `let (a,b): T = x` | `"type annotation not allowed on destructuring pattern"` |

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
- Wildcard `_` in tuple positions
- Nested patterns (recursive)
- Map rename

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
| `src/printing_press/inklang/lowerer.rs` | Add `lower_pattern()` with duplicate detection; update `lower_let`, `lower_const`, `lower_for` |
