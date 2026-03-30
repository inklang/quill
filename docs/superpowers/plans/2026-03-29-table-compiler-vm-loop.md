# Table Compiler-VM Loop Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the end-to-end loop for `table` declarations in Ink — typed schemas, foreign keys, and convenience methods flowing from parser through lowerer/codegen to VM to SQLite.

**Architecture:** The parser already handles `table` with `TableField`. The lowerer already calls `db.registerTable`. We modify the parser to handle `foreign Ident` types contextually, update the lowerer to send typed field descriptor maps instead of string arrays, and update the VM to parse the richer schema and generate typed DDL. New methods (`create`, `save`, `count`) are added to the VM's method dispatch.

**Tech Stack:** Rust (Quill compiler), Kotlin (Ink VM), SQLite (via JDBC)

**Spec:** `docs/superpowers/specs/2026-03-29-table-compiler-vm-loop.md`

**Important context:**
- The ContextVM has TWO `GET_FIELD` dispatch blocks — one at line ~314 (sync) and one at line ~920 (async). Both must be updated when adding new method dispatch.
- `InkScript` takes a `Chunk` in its constructor, not a source string. E2E tests must compile via the Rust compiler CLI and deserialize, or use the Kotlin `ChunkSerializer`.
- `parse_type()` returns a `Token` (not a String). `parse_table()` calls it and takes `.lexeme`. The `foreign` handling goes in `parse_table()` to avoid changing `parse_type()`'s contract.
- Maps are built in IR via `LoadGlobal("Map")` + `NewInstance` + repeated `GetField("set")` + `Call` — there is no `NewMap` opcode.

---

## Chunk 1: Kotlin VM — InkDb Interface + BukkitDb + ContextVM

### Task 1: Update InkDb Interface

**Files:**
- Modify: `ink/ink/src/main/kotlin/org/inklang/InkDb.kt`

- [ ] **Step 1: Add FieldInfo data class and update interfaces**

Replace `registerTable(name: String, fields: List<String>, keyIndex: Int)` with the new signature. Add `FieldInfo` data class. Add `count()`, `countWhere()`, `create()` to `InkTableRef`. Add `count()` to `InkQueryBuilder`.

```kotlin
data class FieldInfo(
    val name: String,
    val inkType: String,        // "int", "string", "float", "double", "bool", "foreign:Player"
    val isKey: Boolean,
    val foreignTable: String?   // null for non-foreign fields
) {
    val sqlType: String get() = when (inkType) {
        "int" -> "INTEGER"
        "float" -> "REAL"
        "double" -> "REAL"
        "string" -> "TEXT"
        "bool" -> "INTEGER"
        else -> "TEXT"
    }
}
```

Update `InkDb`:
```kotlin
interface InkDb {
    fun from(table: String): InkTableRef
    fun registerTable(name: String, fields: List<FieldInfo>)
}
```

Add to `InkTableRef`:
```kotlin
fun count(): Value
fun countWhere(condition: String, vararg args: Value): Value
fun create(data: Map<String, Value>): Value
```

Add to `InkQueryBuilder`:
```kotlin
fun count(): Value
```

- [ ] **Step 2: Verify compilation**

Run: `cd /c/Users/justi/dev/ink && ./gradlew :ink:compileKotlin`
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Commit**

```bash
cd /c/Users/justi/dev/ink
git add ink/src/main/kotlin/org/inklang/InkDb.kt
git commit -m "feat(db): add FieldInfo data class and new table methods to InkDb/InkTableRef"
```

### Task 2: Update BukkitDb Implementation

**Files:**
- Modify: `ink/ink-bukkit/src/main/kotlin/org/inklang/bukkit/BukkitDb.kt`

- [ ] **Step 1: Update registerTable for typed DDL**

Replace `registerTable(name: String, fields: List<String>, keyIndex: Int)`. Update `TableInfo` to store `List<FieldInfo>`. Generate typed `CREATE TABLE IF NOT EXISTS`:

```kotlin
override fun registerTable(name: String, fields: List<FieldInfo>) {
    val keyField = fields.firstOrNull { it.isKey }
        ?: error("Table '$name' must have a key field")
    val keyIndex = fields.indexOf(keyField)
    val columns = fields.joinToString(", ") { field ->
        when {
            field.isKey -> "${field.name} ${field.sqlType} PRIMARY KEY"
            field.foreignTable != null -> "${field.name} ${field.sqlType} REFERENCES ${field.foreignTable}(${keyField.name})"
            else -> "${field.name} ${field.sqlType}"
        }
    }
    conn.createStatement().execute("CREATE TABLE IF NOT EXISTS $name ($columns)")
    tableInfoCache[name] = TableInfo(name, fields, keyIndex)
}
```

Update `TableInfo` data class:
```kotlin
data class TableInfo(
    val name: String,
    val fields: List<FieldInfo>,
    val keyIndex: Int
)
```

- [ ] **Step 2: Add count(), countWhere(), create() to TableRefImpl**

```kotlin
override fun count(): Value {
    val rs = conn.createStatement().executeQuery("SELECT COUNT(*) FROM ${info.name}")
    return if (rs.next()) Value.Int(rs.getInt(1)) else Value.Int(0)
}

override fun countWhere(condition: String, vararg args: Value): Value {
    val pstmt = conn.prepareStatement("SELECT COUNT(*) FROM ${info.name} WHERE $condition")
    args.forEachIndexed { i, v -> bindValue(pstmt, i + 1, v) }
    val rs = pstmt.executeQuery()
    return if (rs.next()) Value.Int(rs.getInt(1)) else Value.Int(0)
}

override fun create(data: Map<String, Value>): Value {
    return insert(data)
}
```

- [ ] **Step 3: Attach row metadata in insert(), find(), resultSetToInstance()**

Add a helper to attach `__table_name` and `__key_value` to returned row instances:

```kotlin
private fun attachMetadata(instance: Value.Instance): Value.Instance {
    val keyCol = info.fields[info.keyIndex].name
    instance.fields["__table_name"] = Value.String(info.name)
    instance.fields["__key_value"] = instance.fields[keyCol] ?: Value.Null
    return instance
}
```

Call `attachMetadata()` at the end of `insert()`, `find()`, and `resultSetToInstance()`.

- [ ] **Step 4: Add count() to QueryBuilderImpl**

```kotlin
override fun count(): Value {
    val pstmt = conn.prepareStatement("SELECT COUNT(*) FROM ${info.name} WHERE $condition")
    args.forEachIndexed { i, v -> bindValue(pstmt, i + 1, v) }
    val rs = pstmt.executeQuery()
    return if (rs.next()) Value.Int(rs.getInt(1)) else Value.Int(0)
}
```

- [ ] **Step 5: Verify compilation**

Run: `cd /c/Users/justi/dev/ink && ./gradlew :ink-bukkit:compileKotlin`
Expected: BUILD SUCCESSFUL

- [ ] **Step 6: Commit**

```bash
cd /c/Users/justi/dev/ink
git add ink-bukkit/src/main/kotlin/org/inklang/bukkit/BukkitDb.kt
git commit -m "feat(db): typed DDL, create/count methods, row metadata in BukkitDb"
```

### Task 3: Update ContextVM Dispatch

**Files:**
- Modify: `ink/ink/src/main/kotlin/org/inklang/ContextVM.kt`

- [ ] **Step 1: Update registerTable native function (line ~102)**

Replace the existing `registerTable` native function to parse `FieldInfo` maps instead of string arrays:

```kotlin
"registerTable" to Value.NativeFunction { args ->
    val tableName = (args.getOrNull(0) as? Value.String)?.value
        ?: error("registerTable requires a table name")
    val fieldsArr = args.getOrNull(1) as? Value.Instance
        ?: error("registerTable requires a fields array")
    val items = (fieldsArr.fields["__items"] as? Value.InternalList)?.items
        ?: error("registerTable requires a fields array")
    val fieldInfos = items.map { item ->
        val map = item as? Value.Instance
            ?: error("registerTable field must be a map")
        val name = (map.fields["name"] as? Value.String)?.value
            ?: error("registerTable field missing 'name'")
        val type = (map.fields["type"] as? Value.String)?.value
            ?: error("registerTable field missing 'type'")
        val isKey = (map.fields["isKey"] as? Value.Boolean)?.value
            ?: error("registerTable field missing 'isKey'")
        val foreignTable = (map.fields["foreignTable"] as? Value.String)?.value
        FieldInfo(name, type, isKey, foreignTable)
    }
    context.db().registerTable(tableName, fieldInfos)
    Value.Null
}
```

- [ ] **Step 2: Add create/count/countWhere dispatch on TableRefInstance**

There are TWO `GET_FIELD` handlers for `Value.TableRefInstance` — one at line ~324 (sync path) and one at line ~930 (async path). Add the same new cases to BOTH locations:

```kotlin
"create" -> Value.NativeFunction { args ->
    val data = args.getOrNull(1) as? Value.Instance
        ?: error("create requires a map argument")
    val entries = (data.fields["__entries"] as? Value.InternalMap)?.entries
        ?: error("create requires a map with __entries")
    val map = entries.mapKeys { (it.key as Value.String).value }.mapValues { it.value }
    obj.tableRef.create(map)
}
"count" -> Value.NativeFunction {
    obj.tableRef.count()
}
"countWhere" -> Value.NativeFunction { args ->
    val condition = (args.getOrNull(1) as? Value.String)?.value
        ?: error("countWhere requires a string condition")
    val queryArgs = args.drop(2)
    obj.tableRef.countWhere(condition, *queryArgs.toTypedArray())
}
```

- [ ] **Step 3: Add row-level save() and delete() on Value.Instance**

In the `is Value.Instance ->` branch of BOTH `GET_FIELD` handlers (line ~318 and ~924), add checks BEFORE the existing field/method lookup:

```kotlin
is Value.Instance -> {
    // Row-level save/delete for DB instances
    if (obj.fields.containsKey("__table_name")) {
        when (fieldName) {
            "save" -> {
                val tableName = (obj.fields["__table_name"] as? Value.String)?.value ?: error("save: missing table metadata")
                val keyVal = obj.fields["__key_value"] ?: Value.Null
                val tableRef = context.db().from(tableName)
                return@GET_FIELD Value.NativeFunction {
                    val updateData = obj.fields
                        .filterKeys { !it.startsWith("__") }
                    tableRef.update(keyVal, updateData)
                    Value.Null
                }
            }
            "delete" -> {
                val tableName = (obj.fields["__table_name"] as? Value.String)?.value ?: error("delete: missing table metadata")
                val keyVal = obj.fields["__key_value"] ?: Value.Null
                val tableRef = context.db().from(tableName)
                return@GET_FIELD Value.NativeFunction {
                    tableRef.delete(keyVal)
                    Value.Null
                }
            }
        }
    }
    // ... existing field/method lookup continues ...
```

Note: `save()` uses `__key_value` (the original key from when the row was loaded), not the current field value. This matches SQL UPDATE semantics.

- [ ] **Step 4: Verify compilation**

Run: `cd /c/Users/justi/dev/ink && ./gradlew :ink:compileKotlin`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
cd /c/Users/justi/dev/ink
git add ink/src/main/kotlin/org/inklang/ContextVM.kt
git commit -m "feat(vm): parse FieldInfo maps, add create/count/save/delete dispatch"
```

### Task 4: Update and Write BukkitDb Unit Tests

**Files:**
- Modify: `ink/ink-bukkit/src/test/kotlin/org/inklang/bukkit/BukkitDbTest.kt`

- [ ] **Step 1: Update existing tests to use FieldInfo-based API**

Replace all calls to the old `registerTable("Player", listOf("id", "name", "score"), 0)` with:

```kotlin
private fun createPlayerTable(): InkTableRef {
    val database = createDb()
    database.registerTable("Player", listOf(
        FieldInfo("id", "int", true, null),
        FieldInfo("name", "string", false, null),
        FieldInfo("score", "int", false, null)
    ))
    return database.from("Player")
}
```

Update all existing tests that use `createPlayerTable()` — they should work unchanged since the table operations remain the same.

- [ ] **Step 2: Write new tests**

```kotlin
@Test
fun `registerTable with typed fields creates typed SQLite table`() {
    val database = createDb()
    database.registerTable("Player", listOf(
        FieldInfo("id", "int", true, null),
        FieldInfo("name", "string", false, null),
        FieldInfo("score", "int", false, null)
    ))
    val rs = (database as BukkitDb).conn.createStatement().executeQuery(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='Player'"
    )
    assertTrue(rs.next())
    val sql = rs.getString("sql")
    assertTrue(sql.contains("id INTEGER PRIMARY KEY"))
    assertTrue(sql.contains("name TEXT"))
    assertTrue(sql.contains("score INTEGER"))
}

@Test
fun `count returns correct number of rows`() {
    val tableRef = createPlayerTable()
    tableRef.insert(mapOf("id" to Value.Int(1), "name" to Value.String("Alice")))
    tableRef.insert(mapOf("id" to Value.Int(2), "name" to Value.String("Bob")))
    assertEquals(Value.Int(2), tableRef.count())
}

@Test
fun `countWhere with condition`() {
    val tableRef = createPlayerTable()
    tableRef.insert(mapOf("id" to Value.Int(1), "name" to Value.String("Alice"), "score" to Value.Int(50)))
    tableRef.insert(mapOf("id" to Value.Int(2), "name" to Value.String("Bob"), "score" to Value.Int(150)))
    assertEquals(Value.Int(1), tableRef.countWhere("score > ?", Value.Int(100)))
}

@Test
fun `foreign key creates REFERENCES constraint`() {
    val database = createDb()
    database.registerTable("Player", listOf(
        FieldInfo("uuid", "string", true, null),
        FieldInfo("name", "string", false, null)
    ))
    database.registerTable("Score", listOf(
        FieldInfo("id", "int", true, null),
        FieldInfo("player_uuid", "foreign:Player", false, "Player"),
        FieldInfo("value", "int", false, null)
    ))
    val rs = (database as BukkitDb).conn.createStatement().executeQuery(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='Score'"
    )
    assertTrue(rs.next())
    val sql = rs.getString("sql")
    assertTrue(sql.contains("REFERENCES Player(uuid)"))
}

@Test
fun `create returns row instance with metadata`() {
    val tableRef = createPlayerTable()
    val row = tableRef.create(mapOf("id" to Value.Int(1), "name" to Value.String("Alice"), "score" to Value.Int(100)))
    assertNotNull(row)
    assertTrue(row is Value.Instance)
    assertEquals("Player", (row.fields["__table_name"] as? Value.String)?.value)
}

@Test
fun `find returns row with metadata for save and delete`() {
    val tableRef = createPlayerTable()
    tableRef.insert(mapOf("id" to Value.Int(1), "name" to Value.String("Alice")))
    val found = tableRef.find(Value.Int(1))
    assertNotNull(found)
    assertTrue(found is Value.Instance)
    assertEquals("Player", (found.fields["__table_name"] as? Value.String)?.value)
    assertEquals(Value.Int(1), found.fields["__key_value"])
}
```

- [ ] **Step 3: Run all BukkitDb tests**

Run: `cd /c/Users/justi/dev/ink && ./gradlew :ink-bukkit:test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
cd /c/Users/justi/dev/ink
git add ink-bukkit/src/test/kotlin/org/inklang/bukkit/BukkitDbTest.kt
git commit -m "test(db): typed schema, count, foreign key, row metadata unit tests"
```

---

## Chunk 2: Rust Compiler — Parser + Lowerer

### Task 5: Update Parser for `foreign` Type

**Files:**
- Modify: `src/printing_press/inklang/parser.rs` (parse_table at line ~530)

- [ ] **Step 1: Write test for foreign type parsing**

Add to the `#[cfg(test)]` module in `parser.rs`:

```rust
#[test]
fn test_parse_foreign_type() {
    let stmts = parse("table Score { key id: int, player_id: foreign Player }");
    match &stmts[0] {
        Stmt::Table { name, fields, .. } => {
            assert_eq!(name.lexeme, "Score");
            assert_eq!(fields.len(), 2);
            assert_eq!(fields[0].type_, Some("int".to_string()));
            assert_eq!(fields[1].type_, Some("foreign:Player".to_string()));
        }
        _ => panic!("Expected Table statement"),
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test test_parse_foreign_type`
Expected: FAIL (parser doesn't handle `foreign` yet)

- [ ] **Step 3: Handle contextual `foreign` in parse_table()**

In `parse_table()` at line ~530-534, replace the field_type parsing:

```rust
let field_type = if self.match_token(&[TokenType::Colon]) {
    // Check for contextual 'foreign' keyword
    if self.check(&TokenType::Identifier) && self.peek().lexeme == "foreign" {
        self.advance(); // consume 'foreign'
        let target = self.consume(&TokenType::Identifier, "Expected table name after 'foreign'")?;
        Some(format!("foreign:{}", target.lexeme))
    } else {
        Some(self.parse_type()?.lexeme)
    }
} else {
    None
};
```

No changes to `parse_type()`, `lexer.rs`, or `token.rs`.

- [ ] **Step 4: Run tests**

Run: `cargo test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/printing_press/inklang/parser.rs
git commit -m "feat(parser): handle 'foreign Ident' as contextual type in table fields"
```

### Task 6: Update Lowerer for Typed Field Descriptors

**Files:**
- Modify: `src/printing_press/inklang/lowerer.rs` (lower_table at lines ~760-842)

- [ ] **Step 1: Add helper to extract foreign table name**

```rust
fn extract_foreign_table(type_str: &Option<String>) -> Option<String> {
    type_str.as_ref().and_then(|t| t.strip_prefix("foreign:").map(|s| s.to_string()))
}
```

- [ ] **Step 2: Rewrite lower_table to build field descriptor maps**

Replace the entire `lower_table()` method. Instead of sending a string array of field names, build an array of Ink maps (using `Map` global + `set` calls). Each map has: `name` (string), `type` (string), `isKey` (bool), `foreignTable` (string or empty string).

Pseudocode for building one field descriptor map:
```
let map_class_reg = fresh_reg();
emit LoadGlobal { dst: map_class_reg, name: "Map" };
let field_map_reg = fresh_reg();
emit NewInstance { dst: field_map_reg, class_reg: map_class_reg, args: [] };

// set("name", field_name)
let name_key_reg = fresh_reg(); emit LoadImm { dst: name_key_reg, index: add_const("name") };
let name_val_reg = fresh_reg(); emit LoadImm { dst: name_val_reg, index: add_const(field.name) };
let set_fn_reg = fresh_reg(); emit GetField { dst: set_fn_reg, obj: field_map_reg, name: "set" };
let _ = fresh_reg(); emit Call { dst: _, func: set_fn_reg, args: [name_key_reg, name_val_reg] };

// set("type", field.type or "")
// set("isKey", field.is_key)
// set("foreignTable", foreign_table or "")
// ... same pattern for each ...
```

Collect all `field_map_reg` values into a `NewArray`, then call `db.registerTable(tableName, fieldMapsArray)` — TWO arguments (no key index).

Keep the existing Step 2 (`db.from("TableName")` + `StoreGlobal`) unchanged.

- [ ] **Step 3: Run tests**

Run: `cargo test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/printing_press/inklang/lowerer.rs
git commit -m "feat(lowerer): send typed field descriptor maps to registerTable"
```

### Task 7: End-to-End Integration Test

**Files:**
- Create: `ink/ink-bukkit/src/test/kotlin/org/inklang/bukkit/TableEndToEndTest.kt`

- [ ] **Step 1: Write end-to-end test**

`InkScript` takes a `Chunk` in its constructor (no static `compile` method). The test must compile the Ink source to a `.inkc` file using the Quill CLI, then deserialize it using `ChunkSerializer`.

```kotlin
package org.inklang.bukkit

import org.inklang.ChunkSerializer
import org.inklang.InkContext
import org.inklang.InkScript
import org.inklang.lang.Value
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.api.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TableEndToEndTest {
    @TempDir
    lateinit var tempDir: File
    private var db: BukkitDb? = null

    private fun createDb(): BukkitDb {
        val dbFile = File(tempDir, "e2e_${System.nanoTime()}.db")
        return BukkitDb(dbFile.absolutePath).also { db = it }
    }

    @AfterEach
    fun tearDown() {
        db?.close()
        db = null
    }

    @Test
    fun `table declaration creates typed table and supports CRUD`() {
        // Step 1: Write Ink source to temp file
        val sourceFile = File(tempDir, "test.ink")
        sourceFile.writeText("""
            table Player {
                key id: int,
                name: string,
                score: int
            }
            let p = Player.create({"id": 1, "name": "Alice", "score": 100})
            let found = Player.find(1)
            print(found.name)
            print(Player.count())
        """.trimIndent())

        // Step 2: Compile with Quill CLI
        val outputFile = File(tempDir, "test.inkc")
        val compileResult = ProcessBuilder(
            "quill", "compile", sourceFile.absolutePath,
            "--output", outputFile.absolutePath
        ).redirectErrorStream(true).start()
        compileResult.waitFor()
        assertEquals(0, compileResult.exitValue(),
            "Compilation failed: ${compileResult.inputStream.bufferedReader().readText()}")

        // Step 3: Deserialize and execute
        val chunk = ChunkSerializer.deserialize(outputFile.readText())
        val script = InkScript("test", chunk)
        val output = mutableListOf<String>()
        val database = createDb()

        val context = object : InkContext {
            override fun print(msg: String) { output.add(msg) }
            override fun log(msg: String) { println("[LOG] $msg") }
            override fun io() = error("io not used")
            override fun json() = error("json not used")
            override fun db() = database
        }

        script.execute(context)

        assertEquals(listOf("Alice", "1"), output)

        // Step 4: Verify SQLite schema
        val rs = database.conn.createStatement().executeQuery(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='Player'"
        )
        assertTrue(rs.next())
        val sql = rs.getString("sql")
        assertTrue(sql.contains("id INTEGER PRIMARY KEY"), "Expected INTEGER PRIMARY KEY: $sql")
        assertTrue(sql.contains("name TEXT"), "Expected TEXT: $sql")
        assertTrue(sql.contains("score INTEGER"), "Expected INTEGER: $sql")
    }
}
```

Note: The implementer must verify that `ChunkSerializer.deserialize()` exists and works with the Quill CLI output format. If the CLI isn't on PATH, use the full path to the built binary.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/justi/dev/ink && ./gradlew :ink-bukkit:test --tests "org.inklang.bukkit.TableEndToEndTest"`
Expected: FAIL (pipeline not yet connected)

- [ ] **Step 3: Debug and fix wiring issues**

Potential issues to check:
- Quill CLI binary location and PATH
- Chunk serialization format compatibility
- `db.registerTable` receiving the correct map structure
- `Player.create` / `Player.find` dispatch working end-to-end

- [ ] **Step 4: Commit**

```bash
cd /c/Users/justi/dev/ink
git add ink-bukkit/src/test/kotlin/org/inklang/bukkit/TableEndToEndTest.kt
git commit -m "test(db): end-to-end test for table declarations with typed schema"
```
