# Table Compiler-VM Loop: Design Spec

**Date:** 2026-03-29
**Status:** Approved

## Goal

Close the end-to-end loop for `table` declarations in Ink. A developer writes `table Player { key id: int, name: string }` and gets a fully-typed SQLite table with convenience methods (`create`, `save`, `count`, `find`, `all`, `delete`, `where`, `update`) — no manual `db.registerTable()` calls needed.

## Scope

- **Ink syntax:** Explicit field types (`int`, `float`, `double`, `string`, `bool`) and `foreign TableName` for foreign keys.
- **Compiler (Quill/Rust):** Parse `foreign` as a contextual keyword, send typed schema to VM via `registerTable`.
- **VM (Ink/Kotlin):** Typed `CREATE TABLE` DDL, new methods (`create`, `save`, `count`), foreign key constraints.
- **Tests:** End-to-end compile + execute test with real SQLite.

**Out of scope:** Type-safe `where` expressions (stays raw SQL strings), auto-relation accessors (`player.scores`), migrations/schema versioning, fixing `order()`/`limit()` no-ops on `TableRefInstance`.

## Ink Syntax

```ink
table Player {
    key uuid: string,
    name: string,
    score: int
}

table Score {
    key id: int,
    player_uuid: foreign Player,
    value: int,
    achieved_at: string
}
```

- `key` marks the primary key field (exactly one per table).
- Types: `int`, `float`, `double`, `string`, `bool`, `foreign <TableName>`.
- `foreign` maps to a SQLite `REFERENCES` constraint. At the Ink level, the field stores the key value — look up related records manually (e.g., `Player.find(score.player_uuid)`).

## Compiler Changes (Quill/Rust)

### Lexer (`lexer.rs`)

Do NOT add `foreign` as a reserved keyword. It remains a regular `Identifier` token. This avoids breaking existing code that uses `foreign` as a variable name.

### Token (`token.rs`)

No changes needed — `foreign` is just an `Identifier`.

### Parser (`parser.rs`)

Modify `parse_type()` (currently at line ~382) to detect the `foreign Ident` pattern. When the current token is an `Identifier` with lexeme `"foreign"`, consume it and the following identifier to produce a compound type string like `"foreign:Player"`. This is contextual — `foreign` is only special inside type position, not as a reserved word.

The `parse_table()` function that calls `parse_type()` requires no changes — it already stores the result in `TableField.type_` as `Option<String>`.

### Lowerer (`lowerer.rs`)

The existing `lower_table()` sends field names as a string array to `db.registerTable("Player", ["uuid", "name", "score"], 0)`. Change it to send an array of field descriptor maps.

**Building maps in IR:** The IR does not have a `NewMap` instruction. Maps are built by instantiating the `Map` global class and calling `set` for each entry (same pattern used in `lower_map_literal`). For each field, emit:

```
LoadGlobal dst=mapClass_reg, name="Map"
NewInstance dst=fieldMap_reg, class_reg=mapClass_reg, args=[]
// set "name"
LoadImm dst=key_reg, index=const("name")
LoadImm dst=val_reg, index=const(field.name)
GetField dst=setFn_reg, obj=fieldMap_reg, name="set"
Call dst=_, func=setFn_reg, args=[key_reg, val_reg]
// repeat for "type", "isKey", "foreignTable"
```

Then collect all field maps into an array via `NewArray`.

The `registerTable` call signature changes to:
```ink
db.registerTable("Player", [
    {"name": "uuid", "type": "string", "isKey": true, "foreignTable": ""},
    {"name": "name", "type": "string", "isKey": false, "foreignTable": ""},
    {"name": "score", "type": "int", "isKey": false, "foreignTable": ""}
])
```

Note: `foreignTable` is sent as an empty string for non-foreign fields, and the table name string for foreign fields. The key index parameter is removed — the VM derives it from `isKey`.

**Breaking change:** This changes the wire format of `registerTable`. Old `.inkc` files that send `["uuid", "name", "score"]` as the second argument will not work with the new VM. This is acceptable — Ink is pre-1.0, there is no stable bytecode format, and all packages will be recompiled.

## VM Changes (Ink/Kotlin)

### InkDb Interface (`InkDb.kt`)

Change `registerTable` signature:

```kotlin
interface InkDb {
    fun from(table: String): InkTableRef
    fun registerTable(name: String, fields: List<FieldInfo>)
}

data class FieldInfo(
    val name: String,
    val inkType: String,        // "int", "string", "float", "double", "bool", "foreign:Player"
    val isKey: Boolean,
    val foreignTable: String?   // null or target table name
) {
    val sqlType: String get() = when (inkType) {
        "int" -> "INTEGER"
        "float" -> "REAL"
        "double" -> "REAL"
        "string" -> "TEXT"
        "bool" -> "INTEGER"
        else -> "TEXT"  // foreign keys default to TEXT; resolved at DDL time if target table is registered
    }
}
```

### ContextVM — `registerTable` Native Function

Update the `registerTable` native function (line ~102) to parse the new map-array argument. For each element in the array, extract `name`, `type`, `isKey`, and `foreignTable` from the Ink map instance and construct `FieldInfo` objects.

### BukkitDb (`BukkitDb.kt`)

`registerTable` now executes typed `CREATE TABLE IF NOT EXISTS`.

**DDL rules:**
- Key field: `<name> <SQL_TYPE> PRIMARY KEY`
- Non-key fields: `<name> <SQL_TYPE>`
- No `NOT NULL` or `DEFAULT` constraints are added — keep it simple, let SQLite's dynamic typing handle defaults
- Foreign key fields: `<name> <SQL_TYPE> REFERENCES <foreignTable>(<foreignTable_key>)`
  - If the referenced table is already registered, use its key field's SQL type. Otherwise, default to TEXT.

```sql
CREATE TABLE IF NOT EXISTS Player (
    uuid TEXT PRIMARY KEY,
    name TEXT,
    score INTEGER
)

CREATE TABLE IF NOT EXISTS Score (
    id INTEGER PRIMARY KEY,
    player_uuid TEXT REFERENCES Player(uuid),
    value INTEGER,
    achieved_at TEXT
)
```

**Registration order:** Foreign key type resolution requires the referenced table to be registered first. The compiler emits `registerTable` calls in source order. If a table references another table that hasn't been registered yet, the foreign key column defaults to TEXT. This is acceptable — developers should declare referenced tables first (same convention as SQL). A `doctor` warning for forward references could be added later.

### ContextVM — New Methods on `TableRefInstance`

Add to the `GET_FIELD` handler:

| Method | Signature | SQL | Returns |
|--------|-----------|-----|---------|
| `create` | `create(data)` | `INSERT INTO ... VALUES (...)` | Row instance |
| `count` | `count()` | `SELECT COUNT(*) FROM table` | `Int` |
| `countWhere` | `countWhere(cond, *args)` | `SELECT COUNT(*) FROM table WHERE ...` | `Int` |

`create` is an alias for the existing `insert` — both remain available.

### Row-Level Methods

When `find()`, `create()`, or `all()` return row instances, attach metadata to enable `save()` and `delete()` on those instances.

**Implementation:** Use a naming convention — store `__table_name` and `__key_value` as fields on the `Value.Instance`. The `__` prefix is reserved for VM-internal use. When `save()` or `delete()` is dispatched on an instance:

- Check for `__table_name` field to identify which table ref to use
- Use `__key_value` for the WHERE clause (captured at creation/query time, not the current field value)
- `save()` reads all non-`__` fields from the instance and emits `UPDATE ... SET ... WHERE key = __key_value`

**Key mutation behavior:** `save()` always uses the original key value from when the row was loaded. If the user mutates the key field (e.g., `p.id = 42`), `save()` updates the row at the original key. This matches SQL semantics where you UPDATE by the old primary key.

### Existing Methods

`all()`, `find(key)`, `insert(data)`, `update(key, data)`, `delete(key)`, `where(condition, *args)` — all work as before.

Known limitation: `order()` and `limit()` on `TableRefInstance` are currently no-ops (return `this` without applying ordering). Fixing these is out of scope for this spec.

## End-to-End Test

New test in `ink-bukkit`:

```kotlin
@Test
fun `table declaration with typed schema`() {
    val source = """
        table Player {
            key id: int,
            name: string,
            score: int
        }

        let p = Player.create({ "id": 1, "name": "Alice", "score": 100 })
        let found = Player.find(1)
        print(found.name)

        let count = Player.count()
        print(count)
    """
    // Compile with Quill Rust compiler (via subprocess or pre-compiled .inkc)
    // Execute on ContextVM with BukkitDb backed by temp SQLite file
    // Assert directly on returned values and DB state (not stdout)
}
```

Also add unit tests for:
- Foreign key `CREATE TABLE` generates `REFERENCES` clause
- `create()` returns row instance with correct fields
- `save()` persists field changes
- `count()` and `countWhere()` return correct values
- Type mismatch on insert (e.g., string into INTEGER column) raises ScriptException
- Row instance `delete()` removes the row
- `save()` uses original key even if key field was mutated

## Files Changed

### Quill (Rust)
- `src/printing_press/inklang/parser.rs` — handle `foreign Ident` in `parse_type()` contextually
- `src/printing_press/inklang/lowerer.rs` — send typed field descriptor maps to `registerTable`, remove key index parameter

### Ink (Kotlin)
- `ink/src/main/kotlin/org/inklang/InkDb.kt` — new `FieldInfo` data class, updated `registerTable` signature
- `ink-bukkit/src/main/kotlin/org/inklang/bukkit/BukkitDb.kt` — typed DDL, `create`/`save`/`count` methods
- `ink/src/main/kotlin/org/inklang/ContextVM.kt` — updated `registerTable` native function, new method dispatch on `TableRefInstance`

### Tests
- `ink-bukkit/src/test/kotlin/org/inklang/bukkit/BukkitDbTest.kt` — updated for new `FieldInfo`-based API + new test cases
- New end-to-end test file in `ink-bukkit`
