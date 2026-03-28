# ink.paper Complete Feature Set Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend ink.paper from 3 declarations (mob, player, command) to 8, plus enhanced runtime class descriptors for world manipulation, inventory, permissions, and persistence.

**Architecture:** Two-layer extension: (1) Grammar declarations in TypeScript (`src/grammar.ts`) defining new keywords/rules, compiled to `grammar.ir.json`. (2) Kotlin runtime executors and class descriptors in the `ink.paper` bridge JAR. Each new declaration maps to a `BlockExecutor` implementation. Action-oriented features (world, inventory, permissions) are exposed as methods on enhanced `ClassDescriptor` instances injected as globals.

**Tech Stack:** TypeScript (grammar DSL), Kotlin (Bukkit/Paper runtime), Gradle (JAR build), vitest (TS tests), Bukkit API (Paper 1.21+)

**Spec:** `docs/superpowers/specs/2026-03-28-ink-paper-complete-feature-set-design.md`

---

## File Structure

### Grammar (TypeScript — in quill repo)

| File | Responsibility |
|------|---------------|
| `tests/fixtures/ink.paper/src/grammar.ts` | All grammar declarations (existing + new) |

### Runtime (Kotlin — in quill repo fixture)

| File | Responsibility |
|------|---------------|
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PaperBridge.kt` | Bridge entry point, block type routing, team registry |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/MobExecutor.kt` | Existing — add `world` global injection |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PlayerExecutor.kt` | Existing — fix async chat, add `world` global |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/CommandExecutor.kt` | Existing — add permission, aliases, `on_execute` |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/TaskExecutor.kt` | **New** — BukkitRunnable scheduler |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/ConfigExecutor.kt` | **New** — YAML config file I/O |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/ScoreboardExecutor.kt` | **New** — Bukkit Scoreboard API |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/TeamExecutor.kt` | **New** — Bukkit Team API |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/RegionExecutor.kt` | **New** — Position polling + enter/leave triggers |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/WorldClass.kt` | **New** — World descriptor with block/biome/spawn methods |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/BlockClass.kt` | **New** — Read-only block snapshot |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/EntityClass.kt` | **New** — Entity Instance wrapper (replaces JavaObject) |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/PlayerClass.kt` | **New** — Enhanced player with inventory/permissions/teams |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/ItemClass.kt` | **New** — Item builder with enchant/name/lore |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/InventoryClass.kt` | **New** — Slot-based inventory access |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/ConfigClass.kt` | **New** — Config file wrapper with get/set/save/reload |
| `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/ServerClass.kt` | **New** — Enhanced server with broadcast/scheduler |

### Tests

| File | Responsibility |
|------|---------------|
| `tests/fixtures/paper-plugin/scripts/test-tasks.ink` | Test script for task declarations |
| `tests/fixtures/paper-plugin/scripts/test-config.ink` | Test script for config declarations |
| `tests/fixtures/paper-plugin/scripts/test-regions.ink` | Test script for region declarations |

---

## Chunk 1: Grammar Declarations

All new grammar keywords and rules in a single update to `grammar.ts`.

### Task 1: Update grammar.ts with all new declarations

**Files:**
- Modify: `tests/fixtures/ink.paper/src/grammar.ts`

- [ ] **Step 1: Add new declarations to grammar.ts**

Add these declarations to the existing `defineGrammar` array, after the existing `command` declaration:

```typescript
    // --- Scheduled Tasks ---
    declaration({
      keyword: 'task',
      inheritsBase: true,
      rules: [
        rule('every_clause', r => r.seq(r.keyword('every'), r.int(), r.keyword('ticks'), r.block()), 'every'),
        rule('delay_clause', r => r.seq(r.keyword('delay'), r.int(), r.keyword('ticks'), r.block()), 'delay'),
      ]
    }),

    // --- Enhanced Command ---
    // (Add new clauses to existing command declaration)
    // NOTE: The existing command declaration needs to be replaced:

    declaration({
      keyword: 'command',
      inheritsBase: true,
      rules: [
        rule('on_execute_clause', r => r.seq(r.keyword('on_execute'), r.block()), 'on_execute'),
        rule('command_clause', r => r.block(), 'on_execute'),  // backwards compat
        rule('permission_clause', r => r.seq(r.keyword('permission'), r.string()), 'permission'),
        rule('alias_clause', r => r.seq(r.keyword('alias'), r.string()), 'alias'),
      ]
    }),

    // --- Config Files ---
    declaration({
      keyword: 'config',
      inheritsBase: true,
      rules: [
        rule('file_clause', r => r.seq(r.keyword('file'), r.string()), 'file'),
        rule('config_entry_clause', r => r.seq(r.identifier(), r.literal(':'), r.choice(r.string(), r.int(), r.float(), r.keyword('true'), r.keyword('false'))), 'config_entry'),
      ]
    }),

    // --- Scoreboard ---
    declaration({
      keyword: 'scoreboard',
      inheritsBase: true,
      rules: [
        rule('objective_clause', r => r.seq(r.keyword('objective'), r.string(), r.block()), 'objective'),
        rule('criteria_clause', r => r.seq(r.keyword('criteria'), r.string()), 'criteria'),
        rule('display_clause', r => r.seq(r.keyword('display'), r.string()), 'display'),
        rule('slot_clause', r => r.seq(r.keyword('slot'), r.choice(r.keyword('sidebar'), r.keyword('player_list'), r.keyword('below_name'))), 'slot'),
      ]
    }),

    // --- Teams ---
    declaration({
      keyword: 'team',
      inheritsBase: true,
      rules: [
        rule('prefix_clause', r => r.seq(r.keyword('prefix'), r.string()), 'prefix'),
        rule('suffix_clause', r => r.seq(r.keyword('suffix'), r.string()), 'suffix'),
        rule('friendly_fire_clause', r => r.seq(r.keyword('friendly_fire'), r.choice(r.keyword('true'), r.keyword('false'))), 'friendly_fire'),
        rule('on_join_clause', r => r.seq(r.keyword('on_join'), r.block()), 'on_join'),
        rule('on_leave_clause', r => r.seq(r.keyword('on_leave'), r.block()), 'on_leave'),
      ]
    }),

    // --- Regions ---
    declaration({
      keyword: 'region',
      inheritsBase: true,
      rules: [
        rule('world_clause', r => r.seq(r.keyword('world'), r.string()), 'world'),
        rule('min_clause', r => r.seq(r.keyword('min'), r.int(), r.literal(','), r.int(), r.literal(','), r.int()), 'min'),
        rule('max_clause', r => r.seq(r.keyword('max'), r.int(), r.literal(','), r.int(), r.literal(','), r.int()), 'max'),
        rule('on_enter_clause', r => r.seq(r.keyword('on_enter'), r.block()), 'on_enter'),
        rule('on_leave_clause', r => r.seq(r.keyword('on_leave'), r.block()), 'on_leave'),
      ]
    }),
```

**IMPORTANT:** Remove the existing `command` declaration (the one with only `command_clause`) since it's replaced above.

- [ ] **Step 2: Verify grammar serializes**

Run: `cd /c/Users/justi/dev/quill && npx tsx tests/fixtures/ink.paper/src/grammar.ts`
Expected: No errors. The grammar exports successfully.

- [ ] **Step 3: Run existing grammar tests**

Run: `cd /c/Users/justi/dev/quill && npx vitest run tests/grammar/`
Expected: All existing tests pass. The new grammar doesn't break serialization/validation.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/ink.paper/src/grammar.ts
git commit -m "feat(ink.paper): add task, config, scoreboard, team, region grammar declarations"
```

---

## Chunk 2: PaperBridge + Base Executor Updates

Update the bridge to handle new block types, fix async chat, add world injection.

### Task 2: Update PaperBridge for new block types and team registry

**Files:**
- Modify: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PaperBridge.kt`

- [ ] **Step 1: Update PaperBridge.kt**

Replace the full contents with:

```kotlin
package org.inklang.paper

import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI
import org.inklang.packages.PackageBridge

class PaperBridge : PackageBridge {

    override val name = "ink.paper"
    override val blockTypes = listOf("mob", "player", "command", "task", "config", "scoreboard", "team", "region")

    private lateinit var host: HostAPI

    // Cross-executor registry for team on_join/on_leave callbacks
    val teamRegistry = mutableMapOf<String, TeamExecutor>()

    override fun onEnable(host: HostAPI) {
        this.host = host
        host.getLogger().info("[ink.paper] enabled")
    }

    override fun onDisable() {
        teamRegistry.clear()
        host.getLogger().info("[ink.paper] disabled")
    }

    override fun createExecutor(
        blockType: String,
        blockName: String,
        vm: ContextVM,
        chunk: Chunk,
        declaration: CstNode.Declaration
    ): BlockExecutor = when (blockType) {
        "mob"        -> MobExecutor(blockName, vm, chunk, declaration, host)
        "player"     -> PlayerExecutor(blockName, vm, chunk, declaration, host)
        "command"    -> CommandExecutor(blockName, vm, chunk, declaration, host)
        "task"       -> TaskExecutor(blockName, vm, chunk, declaration, host)
        "config"     -> ConfigExecutor(blockName, vm, chunk, declaration, host)
        "scoreboard" -> ScoreboardExecutor(blockName, vm, chunk, declaration, host)
        "team"       -> TeamExecutor(blockName, vm, chunk, declaration, host, this)
        "region"     -> RegionExecutor(blockName, vm, chunk, declaration, host)
        else         -> throw IllegalArgumentException("[ink.paper] Unknown block type: $blockType")
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PaperBridge.kt
git commit -m "feat(ink.paper): extend PaperBridge with new block types and team registry"
```

### Task 3: Fix PlayerExecutor async chat + add world global injection

**Files:**
- Modify: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PlayerExecutor.kt`

- [ ] **Step 1: Switch from AsyncPlayerChatEvent to PlayerChatEvent**

In `PlayerListener`, replace `import org.bukkit.event.player.AsyncPlayerChatEvent` with `import org.bukkit.event.player.PlayerChatEvent`. Update `onChat` handler:

```kotlin
import org.bukkit.event.player.PlayerChatEvent
```

Change the event handler:
```kotlin
@EventHandler
fun onChat(event: PlayerChatEvent) {
    fire("on_chat", mapOf(
        "player"  to Value.JavaObject(event.player),
        "message" to Value.String(event.message),
        "cancel"  to Value.NativeFunction { args -> event.isCancelled = true; Value.Null }
    ))
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PlayerExecutor.kt
git commit -m "fix(ink.paper): switch PlayerExecutor to sync PlayerChatEvent for thread safety"
```

---

## Chunk 3: TaskExecutor

### Task 4: Implement TaskExecutor

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/TaskExecutor.kt`

- [ ] **Step 1: Write TaskExecutor.kt**

```kotlin
package org.inklang.paper

import org.bukkit.scheduler.BukkitRunnable
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class TaskExecutor(
    private val taskName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {

    private val taskIds = mutableListOf<Int>()

    override fun activate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
        val server = host.getServer()

        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            val clause = node.ruleName.substringAfterLast('/')
            val fnBlock = node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull() ?: continue
            val funcIdx = fnBlock.funcIdx

            when (clause) {
                "every_clause" -> {
                    val ticks = node.children.filterIsInstance<CstNode.IntLiteral>().firstOrNull()?.value?.toIntOrNull() ?: continue
                    val taskId = object : BukkitRunnable() {
                        override fun run() {
                            fire(funcIdx, buildGlobals(server))
                        }
                    }.runTaskTimer(plugin, 0L, ticks.toLong())
                    taskIds.add(taskId.taskId)
                    host.getLogger().info("[ink.paper/task] Registered '$taskName' every $ticks ticks")
                }
                "delay_clause" -> {
                    val ticks = node.children.filterIsInstance<CstNode.IntLiteral>().firstOrNull()?.value?.toIntOrNull() ?: continue
                    val taskId = object : BukkitRunnable() {
                        override fun run() {
                            fire(funcIdx, buildGlobals(server))
                        }
                    }.runTaskLater(plugin, ticks.toLong())
                    taskIds.add(taskId.taskId)
                    host.getLogger().info("[ink.paper/task] Registered '$taskName' delay $ticks ticks")
                }
            }
        }
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}

    override fun deactivate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
        for (taskId in taskIds) {
            plugin.server.scheduler.cancelTask(taskId)
        }
        taskIds.clear()
    }

    private fun buildGlobals(server: Any): Map<String, Value> {
        // Basic globals — will be enhanced with WorldClass/ServerClass later
        return mapOf(
            "server" to Value.JavaObject(server)
        )
    }

    private fun fire(funcIdx: Int, globals: Map<String, Value>) {
        if (funcIdx >= chunk.functions.size) return
        try {
            vm.executeWithLock {
                vm.setGlobals(globals)
                vm.execute(chunk.functions[funcIdx])
            }
        } catch (e: Exception) {
            host.getLogger().warning("[ink.paper] Error in task '$taskName': ${e.message}")
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/TaskExecutor.kt
git commit -m "feat(ink.paper): add TaskExecutor for scheduled tasks (every/delay)"
```

---

## Chunk 4: ConfigExecutor + ConfigClass

### Task 5: Implement ConfigClass descriptor

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/ConfigClass.kt`

- [ ] **Step 1: Write ConfigClass.kt**

```kotlin
package org.inklang.paper.classes

import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value
import java.io.File

object ConfigClass {

    fun create(name: String, data: MutableMap<String, Value>, file: File): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "Config",
            superClass = null,
            readOnly = false,
            methods = mapOf(
                "get" to Value.NativeFunction { args ->
                    val key = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    data[key] ?: Value.Null
                },
                "set" to Value.NativeFunction { args ->
                    val key = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val value = args.getOrNull(1) ?: Value.Null
                    data[key] = value
                    Value.Null
                },
                "save" to Value.NativeFunction { _ ->
                    saveYaml(file, data)
                    Value.Null
                },
                "reload" to Value.NativeFunction { _ ->
                    val reloaded = loadYaml(file)
                    data.clear()
                    data.putAll(reloaded)
                    Value.Null
                }
            )
        )
        val instance = Value.Instance(descriptor, data.toMutableMap())
        return instance
    }

    fun loadYaml(file: File): MutableMap<String, Value> {
        val result = mutableMapOf<String, Value>()
        if (!file.exists()) return result
        val lines = file.readLines()
        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("#")) continue
            val colonIdx = trimmed.indexOf(':')
            if (colonIdx < 0) continue
            val key = trimmed.substring(0, colonIdx).trim()
            val raw = trimmed.substring(colonIdx + 1).trim()
            val value = parseYamlValue(raw)
            result[key] = value
        }
        return result
    }

    fun saveYaml(file: File, data: Map<String, Value>) {
        val lines = data.map { (k, v) -> "$k: ${formatYamlValue(v)}" }
        file.parentFile.mkdirs()
        file.writeText(lines.joinToString("\n"))
    }

    private fun parseYamlValue(raw: String): Value {
        return when {
            raw == "true"  -> Value.Boolean(true)
            raw == "false" -> Value.Boolean(false)
            raw.startsWith("\"") && raw.endsWith("\"") -> Value.String(raw.removeSurrounding("\""))
            raw.toIntOrNull() != null -> Value.Int(raw.toInt())
            raw.toDoubleOrNull() != null -> Value.Double(raw.toDouble())
            else -> Value.String(raw)
        }
    }

    private fun formatYamlValue(v: Value): String = when (v) {
        is Value.Boolean -> v.value.toString()
        is Value.Int -> v.value.toString()
        is Value.Double -> v.value.toString()
        is Value.String -> "\"${v.value}\""
        else -> "\"$v\""
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/ConfigClass.kt
git commit -m "feat(ink.paper): add ConfigClass descriptor for config file access"
```

### Task 6: Implement ConfigExecutor

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/ConfigExecutor.kt`

- [ ] **Step 1: Write ConfigExecutor.kt**

```kotlin
package org.inklang.paper

import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI
import org.inklang.paper.classes.ConfigClass
import java.io.File

class ConfigExecutor(
    private val configName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {

    private val RESERVED_NAMES = setOf("get", "set", "save", "reload")

    override fun activate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
        val configsDir = File(plugin.dataFolder, "configs")
        configsDir.mkdirs()

        // Extract filename
        val fileName = declaration.body
            .filterIsInstance<CstNode.RuleMatch>()
            .find { it.ruleName.substringAfterLast('/') == "file_clause" }
            ?.children?.filterIsInstance<CstNode.StringLiteral>()?.firstOrNull()?.value
            ?: "$configName.yml"

        val file = File(configsDir, fileName)

        // Extract defaults from config_entry_clause
        val defaults = mutableMapOf<String, Value>()
        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            if (node.ruleName.substringAfterLast('/') != "config_entry_clause") continue
            val children = node.children
            val key = children.filterIsInstance<CstNode.IdentifierNode>().firstOrNull()?.value ?: continue
            val value = parseEntryValue(children) ?: continue
            if (key in RESERVED_NAMES) {
                host.getLogger().warning("[ink.paper/config] Key '$key' in '$configName' collides with method name — may be inaccessible")
            }
            defaults[key] = value
        }

        // Load existing or write defaults
        val data = if (file.exists()) {
            val loaded = ConfigClass.loadYaml(file)
            // Merge: defaults fill in missing keys
            for ((k, v) in defaults) {
                if (k !in loaded) loaded[k] = v
            }
            loaded
        } else {
            ConfigClass.saveYaml(file, defaults)
            defaults.toMutableMap()
        }

        // Register as global
        val configInstance = ConfigClass.create(configName, data, file)
        vm.executeWithLock {
            vm.setGlobals(mapOf(configName to configInstance))
        }

        host.getLogger().info("[ink.paper/config] Registered '$configName' (${defaults.size} defaults, file: $fileName)")
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}

    override fun deactivate() {
        // Config globals persist — no cleanup needed
    }

    private fun parseEntryValue(children: List<CstNode>): Value? {
        children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.let { return Value.String(it.value) }
        children.filterIsInstance<CstNode.IntLiteral>().firstOrNull()?.let { return Value.Int(it.value.toInt()) }
        children.filterIsInstance<CstNode.FloatLiteral>().firstOrNull()?.let { return Value.Double(it.value.toDouble()) }
        children.filterIsInstance<CstNode.KeywordNode>().firstOrNull()?.let {
            return when (it.value) {
                "true" -> Value.Boolean(true)
                "false" -> Value.Boolean(false)
                else -> null
            }
        }
        return null
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/ConfigExecutor.kt
git commit -m "feat(ink.paper): add ConfigExecutor for YAML config file management"
```

---

## Chunk 5: Enhanced CommandExecutor

### Task 7: Add permission + aliases + on_execute to CommandExecutor

**Files:**
- Modify: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/CommandExecutor.kt`

- [ ] **Step 1: Rewrite CommandExecutor.kt**

Replace the full file with an enhanced version that reads `permission_clause`, `alias_clause`, and `on_execute_clause` from the CST:

```kotlin
package org.inklang.paper

import org.bukkit.command.Command
import org.bukkit.command.CommandSender
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Builtins
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class CommandExecutor(
    private val commandName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {

    override fun activate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin

        // Find the handler function (on_execute_clause or legacy command_clause)
        val fnBlock = findHandlerBlock() ?: run {
            host.getLogger().warning("[ink.paper/command] No function block in '/$commandName'")
            return
        }
        val funcIdx = fnBlock.funcIdx

        // Extract permission
        val permission = declaration.body
            .filterIsInstance<CstNode.RuleMatch>()
            .find { it.ruleName.substringAfterLast('/') == "permission_clause" }
            ?.children?.filterIsInstance<CstNode.StringLiteral>()?.firstOrNull()?.value

        // Extract aliases
        val aliases = declaration.body
            .filterIsInstance<CstNode.RuleMatch>()
            .filter { it.ruleName.substringAfterLast('/') == "alias_clause" }
            .mapNotNull { it.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value }

        // Register command
        val cmd = object : Command(commandName) {
            override fun execute(sender: CommandSender, label: String, args: Array<out String>): Boolean {
                try {
                    val globals = mutableMapOf<String, Value>(
                        "sender" to Value.JavaObject(sender),
                        "args"   to Builtins.newArray(args.map { Value.String(it) }.toMutableList())
                    )
                    vm.executeWithLock {
                        vm.setGlobals(globals)
                        vm.execute(chunk.functions[funcIdx])
                    }
                } catch (e: Exception) {
                    System.err.println("[ink.paper] Error in command '/$commandName': ${e.message}")
                }
                return true
            }
        }

        permission?.let { cmd.setPermission(it) }
        if (aliases.isNotEmpty()) cmd.setAliases(aliases)

        plugin.server.commandMap.register(plugin.description.name.lowercase(), cmd)
        host.getLogger().info("[ink.paper/command] Registered /$commandName" +
            (if (permission != null) " (perm: $permission)" else "") +
            (if (aliases.isNotEmpty()) " (aliases: ${aliases.joinToString()})" else ""))
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}

    override fun deactivate() {
        // Bukkit commandMap has no clean unregister API
    }

    private fun findHandlerBlock(): CstNode.FunctionBlock? {
        // Try on_execute_clause first, then fall back to command_clause
        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            val clause = node.ruleName.substringAfterLast('/')
            if (clause == "on_execute_clause" || clause == "command_clause") {
                return node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull()
            }
        }
        // Legacy: bare FunctionBlock directly in body
        return declaration.body.filterIsInstance<CstNode.FunctionBlock>().firstOrNull()
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/CommandExecutor.kt
git commit -m "feat(ink.paper): enhance CommandExecutor with permission, aliases, on_execute"
```

---

## Chunk 6: ScoreboardExecutor

### Task 8: Implement ScoreboardExecutor

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/ScoreboardExecutor.kt`

- [ ] **Step 1: Write ScoreboardExecutor.kt**

```kotlin
package org.inklang.paper

import org.bukkit.Bukkit
import org.bukkit.scoreboard.Criteria
import org.bukkit.scoreboard.DisplaySlot
import org.bukkit.scoreboard.Objective
import org.bukkit.scoreboard.Scoreboard
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class ScoreboardExecutor(
    private val boardName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {

    private var scoreboard: Scoreboard? = null

    override fun activate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
        val sb = Bukkit.getScoreboardManager()?.mainScoreboard
            ?: Bukkit.getScoreboardManager()!!.newScoreboard
        scoreboard = sb

        // Process each objective_clause
        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            if (node.ruleName.substringAfterLast('/') != "objective_clause") continue

            val objName = node.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value ?: continue
            val objBlock = node.children.filterIsInstance<CstNode.Block>().firstOrNull() ?: continue

            // Extract criteria, display, slot from the objective's block
            var criteria = "dummy"
            var displayName = objName
            var slot: DisplaySlot? = null

            for (child in objBlock.children) {
                if (child !is CstNode.RuleMatch) continue
                val clause = child.ruleName.substringAfterLast('/')
                when (clause) {
                    "criteria_clause" -> {
                        criteria = child.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value ?: criteria
                    }
                    "display_clause" -> {
                        displayName = child.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value ?: displayName
                    }
                    "slot_clause" -> {
                        val slotKeyword = child.children.filterIsInstance<CstNode.KeywordNode>().firstOrNull()?.value
                        slot = when (slotKeyword) {
                            "sidebar" -> DisplaySlot.SIDEBAR
                            "player_list" -> DisplaySlot.PLAYER_LIST
                            "below_name" -> DisplaySlot.BELOW_NAME
                            else -> null
                        }
                    }
                }
            }

            // Create or get the objective
            val objective = sb.getObjective(objName)
                ?: sb.registerNewObjective(objName, criteria, displayName)

            if (slot != null) {
                objective.displaySlot = slot
            }

            host.getLogger().info("[ink.paper/scoreboard] Objective '$objName' (criteria=$criteria, display=$displayName, slot=${slot?.name})")
        }

        // Register globals for score access
        val descriptor = org.inklang.lang.ClassDescriptor(
            name = "Scoreboard",
            superClass = null,
            readOnly = true,
            methods = mapOf(
                "get_score" to Value.NativeFunction { args ->
                    val playerName = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Int(0)
                    val objectiveName = (args.getOrNull(1) as? Value.String)?.value ?: return@NativeFunction Value.Int(0)
                    val obj = sb.getObjective(objectiveName) ?: return@NativeFunction Value.Int(0)
                    Value.Int(obj.getScore(playerName).score)
                },
                "set_score" to Value.NativeFunction { args ->
                    val playerName = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val objectiveName = (args.getOrNull(1) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val score = (args.getOrNull(2) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val obj = sb.getObjective(objectiveName) ?: return@NativeFunction Value.Null
                    obj.getScore(playerName).score = score
                    Value.Null
                },
                "add_score" to Value.NativeFunction { args ->
                    val playerName = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val objectiveName = (args.getOrNull(1) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val amount = (args.getOrNull(2) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val obj = sb.getObjective(objectiveName) ?: return@NativeFunction Value.Null
                    val score = obj.getScore(playerName)
                    score.score = score.score + amount
                    Value.Null
                }
            )
        )

        vm.executeWithLock {
            vm.setGlobals(mapOf(boardName to Value.Instance(descriptor, mutableMapOf())))
        }

        host.getLogger().info("[ink.paper/scoreboard] Registered '$boardName'")
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}

    override fun deactivate() {
        // Objectives persist on the main scoreboard — no cleanup
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/ScoreboardExecutor.kt
git commit -m "feat(ink.paper): add ScoreboardExecutor with objectives and score access"
```

---

## Chunk 7: TeamExecutor

### Task 9: Implement TeamExecutor

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/TeamExecutor.kt`

- [ ] **Step 1: Write TeamExecutor.kt**

```kotlin
package org.inklang.paper

import org.bukkit.Bukkit
import org.bukkit.scoreboard.Team
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class TeamExecutor(
    private val teamName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI,
    private val bridge: PaperBridge
) : BlockExecutor {

    private var bukkitTeam: Team? = null
    private val handlers = mutableMapOf<String, Int>()

    override fun activate() {
        val sb = Bukkit.getScoreboardManager()?.mainScoreboard ?: return

        // Create or get team
        val team = sb.getTeam(teamName) ?: sb.registerNewTeam(teamName)
        bukkitTeam = team

        // Extract settings from CST
        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            val clause = node.ruleName.substringAfterLast('/')
            when (clause) {
                "prefix_clause" -> {
                    val prefix = node.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value ?: continue
                    team.prefix = prefix
                }
                "suffix_clause" -> {
                    val suffix = node.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value ?: continue
                    team.suffix = suffix
                }
                "friendly_fire_clause" -> {
                    val keyword = node.children.filterIsInstance<CstNode.KeywordNode>().firstOrNull()?.value ?: continue
                    team.setAllowFriendlyFire(keyword == "true")
                }
                "on_join_clause" -> {
                    val fnBlock = node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull() ?: continue
                    handlers["on_join"] = fnBlock.funcIdx
                }
                "on_leave_clause" -> {
                    val fnBlock = node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull() ?: continue
                    handlers["on_leave"] = fnBlock.funcIdx
                }
            }
        }

        // Register in bridge's teamRegistry for cross-executor access
        bridge.teamRegistry[teamName] = this

        host.getLogger().info("[ink.paper/team] Registered '$teamName' (handlers: ${handlers.keys.joinToString()})")
    }

    fun triggerHandler(eventName: String, playerGlobal: Value) {
        val funcIdx = handlers[eventName] ?: return
        if (funcIdx >= chunk.functions.size) return
        try {
            vm.executeWithLock {
                vm.setGlobals(mapOf("player" to playerGlobal))
                vm.execute(chunk.functions[funcIdx])
            }
        } catch (e: Exception) {
            host.getLogger().warning("[ink.paper] Error in team '$teamName' $eventName: ${e.message}")
        }
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}

    override fun deactivate() {
        bukkitTeam?.unregister()
        bukkitTeam = null
        bridge.teamRegistry.remove(teamName)
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/TeamExecutor.kt
git commit -m "feat(ink.paper): add TeamExecutor with prefix/suffix/friendly_fire and on_join/on_leave"
```

---

## Chunk 8: RegionExecutor

### Task 10: Implement RegionExecutor

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/RegionExecutor.kt`

- [ ] **Step 1: Write RegionExecutor.kt**

```kotlin
package org.inklang.paper

import org.bukkit.Bukkit
import org.bukkit.Location
import org.bukkit.scheduler.BukkitRunnable
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class RegionExecutor(
    private val regionName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {

    private var taskId: Int? = null
    private val playersInside = mutableSetOf<String>()
    private val handlers = mutableMapOf<String, Int>()
    private var worldName: String? = null
    private var minX = 0; private var minY = 0; private var minZ = 0
    private var maxX = 0; private var maxY = 0; private var maxZ = 0

    override fun activate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
        val server = host.getServer()

        // Extract settings from CST
        val ints = mutableListOf<Int>()
        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            val clause = node.ruleName.substringAfterLast('/')
            when (clause) {
                "world_clause" -> {
                    worldName = node.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value
                }
                "min_clause" -> {
                    val values = node.children.filterIsInstance<CstNode.IntLiteral>().mapNotNull { it.value.toIntOrNull() }
                    if (values.size >= 3) { minX = values[0]; minY = values[1]; minZ = values[2] }
                }
                "max_clause" -> {
                    val values = node.children.filterIsInstance<CstNode.IntLiteral>().mapNotNull { it.value.toIntOrNull() }
                    if (values.size >= 3) { maxX = values[0]; maxY = values[1]; maxZ = values[2] }
                }
                "on_enter_clause" -> {
                    val fnBlock = node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull() ?: continue
                    handlers["on_enter"] = fnBlock.funcIdx
                }
                "on_leave_clause" -> {
                    val fnBlock = node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull() ?: continue
                    handlers["on_leave"] = fnBlock.funcIdx
                }
            }
        }

        // Start polling task (every 20 ticks = 1 second)
        val id = object : BukkitRunnable() {
            override fun run() {
                pollPlayers(server)
            }
        }.runTaskTimer(plugin, 0L, 20L)
        taskId = id.taskId

        host.getLogger().info("[ink.paper/region] Registered '$regionName' ($minX,$minY,$minZ -> $maxX,$maxY,$maxZ)")
    }

    private fun pollPlayers(server: Any) {
        val bukkitServer = server as org.bukkit.Server
        val currentPlayers = mutableSetOf<String>()

        for (player in bukkitServer.onlinePlayers) {
            if (worldName != null && player.world.name != worldName) continue
            val loc = player.location
            if (loc.x >= minX && loc.x <= maxX &&
                loc.y >= minY && loc.y <= maxY &&
                loc.z >= minZ && loc.z <= maxZ) {
                currentPlayers.add(player.name)
            }
        }

        // Entered
        for (name in currentPlayers - playersInside) {
            val player = bukkitServer.getPlayer(name) ?: continue
            fire("on_enter", mapOf("player" to Value.JavaObject(player)))
        }

        // Left
        for (name in playersInside - currentPlayers) {
            val player = bukkitServer.getPlayer(name) ?: continue
            fire("on_leave", mapOf("player" to Value.JavaObject(player)))
        }

        playersInside.clear()
        playersInside.addAll(currentPlayers)
    }

    private fun fire(eventName: String, globals: Map<String, Value>) {
        val funcIdx = handlers[eventName] ?: return
        if (funcIdx >= chunk.functions.size) return
        try {
            vm.executeWithLock {
                vm.setGlobals(globals)
                vm.execute(chunk.functions[funcIdx])
            }
        } catch (e: Exception) {
            host.getLogger().warning("[ink.paper] Error in region '$regionName' $eventName: ${e.message}")
        }
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}

    override fun deactivate() {
        taskId?.let {
            val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
            plugin.server.scheduler.cancelTask(it)
        }
        playersInside.clear()
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/RegionExecutor.kt
git commit -m "feat(ink.paper): add RegionExecutor with position polling and enter/leave triggers"
```

---

## Chunk 9: Class Descriptors (World, Block, Entity, Item, Inventory, Player, Server)

These are pure Kotlin class descriptors — no grammar changes, no executors. They enhance the globals available to all handlers.

### Task 11: Implement WorldClass + BlockClass

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/WorldClass.kt`
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/BlockClass.kt`

- [ ] **Step 1: Write BlockClass.kt** (simpler, no dependencies)

```kotlin
package org.inklang.paper.classes

import org.bukkit.block.Block
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object BlockClass {

    fun create(block: Block): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "Block",
            superClass = null,
            readOnly = true,
            methods = emptyMap()
        )
        val fields = mutableMapOf(
            "type" to Value.String(block.type.name),
            "x" to Value.Int(block.x),
            "y" to Value.Int(block.y),
            "z" to Value.Int(block.z),
            "biome" to Value.String(block.biome.name),
            "light" to Value.Int(block.lightFromBlocks),
            "isAir" to Value.Boolean(block.type.isAir),
            "isLiquid" to Value.Boolean(block.type.isLiquid),
            "isSolid" to Value.Boolean(block.type.isSolid)
        )
        return Value.Instance(descriptor, fields)
    }
}
```

- [ ] **Step 2: Write WorldClass.kt**

```kotlin
package org.inklang.paper.classes

import org.bukkit.Material
import org.bukkit.World
import org.bukkit.entity.EntityType
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object WorldClass {

    fun create(world: World): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "World",
            superClass = null,
            readOnly = false,
            methods = mapOf(
                // Read-only properties
                "name" to Value.NativeFunction { _ -> Value.String(world.name) },
                "seed" to Value.NativeFunction { _ -> Value.Int(world.seed.toInt()) },
                "environment" to Value.NativeFunction { _ -> Value.String(world.environment.name.lowercase()) },
                // Get/Set properties
                "time" to Value.NativeFunction { _ -> Value.Int(world.time.toInt()) },
                "set_time" to Value.NativeFunction { args ->
                    val t = (args.getOrNull(0) as? Value.Int)?.value?.toLong() ?: return@NativeFunction Value.Null
                    world.time = t
                    Value.Null
                },
                "weather" to Value.NativeFunction { _ ->
                    val w = when {
                        world.isThundering -> "thunder"
                        world.hasStorm -> "rain"
                        else -> "clear"
                    }
                    Value.String(w)
                },
                "set_weather" to Value.NativeFunction { args ->
                    val w = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    when (w) {
                        "clear" -> { world.isThundering = false; world.setStorm(false) }
                        "rain" -> { world.setStorm(true); world.isThundering = false }
                        "thunder" -> { world.setStorm(true); world.isThundering = true }
                    }
                    Value.Null
                },
                "difficulty" to Value.NativeFunction { _ -> Value.String(world.difficulty.name.lowercase()) },
                "set_difficulty" to Value.NativeFunction { args ->
                    val d = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    world.difficulty = org.bukkit.Difficulty.valueOf(d.uppercase())
                    Value.Null
                },
                "pvp" to Value.NativeFunction { _ -> Value.Boolean(world.pvp) },
                "set_pvp" to Value.NativeFunction { args ->
                    val p = (args.getOrNull(0) as? Value.Boolean)?.value ?: return@NativeFunction Value.Null
                    world.pvp = p
                    Value.Null
                },
                // Methods
                "getBlock" to Value.NativeFunction { args ->
                    val x = (args.getOrNull(0) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val y = (args.getOrNull(1) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val z = (args.getOrNull(2) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    BlockClass.create(world.getBlockAt(x, y, z))
                },
                "setBlock" to Value.NativeFunction { args ->
                    val x = (args.getOrNull(0) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val y = (args.getOrNull(1) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val z = (args.getOrNull(2) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val material = (args.getOrNull(3) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val matName = material.removePrefix("minecraft:").uppercase()
                    val mat = Material.matchMaterial(matName)
                        ?: return@NativeFunction Value.Null
                    world.getBlockAt(x, y, z).type = mat
                    Value.Null
                },
                "getBiome" to Value.NativeFunction { args ->
                    val x = (args.getOrNull(0) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val y = (args.getOrNull(1) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val z = (args.getOrNull(2) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    Value.String(world.getBiome(x, y, z).name)
                },
                "getHeight" to Value.NativeFunction { args ->
                    val x = (args.getOrNull(0) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val z = (args.getOrNull(1) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    Value.Int(world.getHighestBlockYAt(x, z))
                },
                "spawnEntity" to Value.NativeFunction { args ->
                    val type = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val x = (args.getOrNull(1) as? Value.Int)?.value?.toDouble() ?: return@NativeFunction Value.Null
                    val y = (args.getOrNull(2) as? Value.Int)?.value?.toDouble() ?: return@NativeFunction Value.Null
                    val z = (args.getOrNull(3) as? Value.Int)?.value?.toDouble() ?: return@NativeFunction Value.Null
                    val entityType = runCatching { EntityType.valueOf(type.uppercase()) }.getOrNull()
                        ?: return@NativeFunction Value.Null
                    val entity = world.spawnEntity(org.bukkit.Location(world, x, y, z), entityType)
                    Value.JavaObject(entity)
                },
                "createExplosion" to Value.NativeFunction { args ->
                    val x = (args.getOrNull(0) as? Value.Int)?.value?.toDouble() ?: return@NativeFunction Value.Null
                    val y = (args.getOrNull(1) as? Value.Int)?.value?.toDouble() ?: return@NativeFunction Value.Null
                    val z = (args.getOrNull(2) as? Value.Int)?.value?.toDouble() ?: return@NativeFunction Value.Null
                    val power = (args.getOrNull(3) as? Value.Int)?.value?.toFloat() ?: 4f
                    world.createExplosion(x, y, z, power, false, true)
                    Value.Null
                },
                "createItem" to Value.NativeFunction { args ->
                    val material = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val count = (args.getOrNull(1) as? Value.Int)?.value ?: 1
                    val mat = Material.matchMaterial(material.removePrefix("minecraft:").uppercase())
                        ?: return@NativeFunction Value.Null
                    val stack = org.bukkit.inventory.ItemStack(mat, count)
                    ItemClass.create(stack)
                }
            )
        )
        return Value.Instance(descriptor, mutableMapOf())
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/WorldClass.kt tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/BlockClass.kt
git commit -m "feat(ink.paper): add WorldClass and BlockClass descriptors for world manipulation"
```

### Task 12: Implement ItemClass + InventoryClass

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/ItemClass.kt`
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/InventoryClass.kt`

- [ ] **Step 1: Write ItemClass.kt**

```kotlin
package org.inklang.paper.classes

import org.bukkit.Material
import org.bukkit.inventory.ItemStack
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object ItemClass {

    fun create(stack: ItemStack): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "Item",
            superClass = null,
            readOnly = false,
            methods = mapOf(
                "type" to Value.NativeFunction { _ -> Value.String(stack.type.name) },
                "count" to Value.NativeFunction { _ -> Value.Int(stack.amount) },
                "set_count" to Value.NativeFunction { args ->
                    val c = (args.getOrNull(0) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    stack.amount = c
                    Value.Null
                },
                "name" to Value.NativeFunction { _ ->
                    val name = stack.itemMeta?.displayName() ?: stack.type.name
                    Value.String(name)
                },
                "set_name" to Value.NativeFunction { args ->
                    val n = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val meta = stack.itemMeta ?: return@NativeFunction Value.Null
                    meta.setDisplayName(n)
                    stack.itemMeta = meta
                    Value.Null
                },
                "isUnbreakable" to Value.NativeFunction { _ ->
                    Value.Boolean(stack.itemMeta?.isUnbreakable ?: false)
                },
                "set_unbreakable" to Value.NativeFunction { args ->
                    val b = (args.getOrNull(0) as? Value.Boolean)?.value ?: return@NativeFunction Value.Null
                    val meta = stack.itemMeta ?: return@NativeFunction Value.Null
                    meta.isUnbreakable = b
                    stack.itemMeta = meta
                    Value.Null
                },
                "enchant" to Value.NativeFunction { args ->
                    val enchantName = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val level = (args.getOrNull(1) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val meta = stack.itemMeta ?: return@NativeFunction Value.Null
                    val enchant = org.bukkit.enchantments.Enchantment.getByName(enchantName.uppercase())
                        ?: return@NativeFunction Value.Null
                    meta.addEnchant(enchant, level, true)
                    stack.itemMeta = meta
                    Value.Null
                },
                // Get the underlying JavaObject for give() / dropItem()
                "raw" to Value.NativeFunction { _ -> Value.JavaObject(stack) }
            )
        )
        return Value.Instance(descriptor, mutableMapOf())
    }
}
```

- [ ] **Step 2: Write InventoryClass.kt**

```kotlin
package org.inklang.paper.classes

import org.bukkit.Material
import org.bukkit.inventory.Inventory
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object InventoryClass {

    fun create(inventory: Inventory): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "Inventory",
            superClass = null,
            readOnly = true,
            methods = mapOf(
                "size" to Value.NativeFunction { _ -> Value.Int(inventory.size) },
                "getItem" to Value.NativeFunction { args ->
                    val slot = (args.getOrNull(0) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val item = inventory.getItem(slot) ?: return@NativeFunction Value.Null
                    if (item.type == Material.AIR) return@NativeFunction Value.Null
                    ItemClass.create(item)
                },
                "setItem" to Value.NativeFunction { args ->
                    val slot = (args.getOrNull(0) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val itemValue = args.getOrNull(1) ?: return@NativeFunction Value.Null
                    val stack = when (itemValue) {
                        is Value.JavaObject -> itemValue.obj as? org.bukkit.inventory.ItemStack
                        is Value.Instance -> {
                            // Try to get raw ItemStack from ItemClass
                            val rawMethod = itemValue.clazz.methods["raw"]
                            if (rawMethod is Value.NativeFunction) {
                                (rawMethod.fn(listOf()) as? Value.JavaObject)?.obj as? org.bukkit.inventory.ItemStack
                            } else null
                        }
                        else -> null
                    } ?: return@NativeFunction Value.Null
                    inventory.setItem(slot, stack)
                    Value.Null
                },
                "clear" to Value.NativeFunction { args ->
                    val slot = args.getOrNull(0)
                    if (slot is Value.Int) {
                        inventory.clear(slot.value)
                    } else {
                        inventory.clear()
                    }
                    Value.Null
                },
                "contains" to Value.NativeFunction { args ->
                    val material = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Boolean(false)
                    val mat = Material.matchMaterial(material.uppercase()) ?: return@NativeFunction Value.Boolean(false)
                    Value.Boolean(inventory.contains(mat))
                }
            )
        )
        return Value.Instance(descriptor, mutableMapOf())
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/ItemClass.kt tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/InventoryClass.kt
git commit -m "feat(ink.paper): add ItemClass and InventoryClass descriptors"
```

### Task 13: Implement EntityClass + PlayerClass + ServerClass

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/EntityClass.kt`
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/PlayerClass.kt`
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/ServerClass.kt`

- [ ] **Step 1: Write EntityClass.kt**

```kotlin
package org.inklang.paper.classes

import org.bukkit.entity.Entity
import org.bukkit.entity.LivingEntity
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object EntityClass {

    fun create(entity: Entity): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "Entity",
            superClass = null,
            readOnly = false,
            methods = mapOf(
                "type" to Value.NativeFunction { _ -> Value.String(entity.type.name) },
                "isAlive" to Value.NativeFunction { _ -> Value.Boolean(entity is LivingEntity) },
                "world" to Value.NativeFunction { _ -> Value.String(entity.world.name) },
                "x" to Value.NativeFunction { _ -> Value.Double(entity.location.x) },
                "y" to Value.NativeFunction { _ -> Value.Double(entity.location.y) },
                "z" to Value.NativeFunction { _ -> Value.Double(entity.location.z) },
                "health" to Value.NativeFunction { _ ->
                    if (entity is LivingEntity) Value.Double(entity.health) else Value.Null
                },
                "set_health" to Value.NativeFunction { args ->
                    val h = (args.getOrNull(0) as? Value.Double)?.value ?: return@NativeFunction Value.Null
                    if (entity is LivingEntity) entity.health = h
                    Value.Null
                },
                "remove" to Value.NativeFunction { _ -> entity.remove(); Value.Null },
                "kill" to Value.NativeFunction { _ ->
                    if (entity is LivingEntity) entity.health = 0.0 else entity.remove()
                    Value.Null
                },
                "teleport" to Value.NativeFunction { args ->
                    val x = (args.getOrNull(0) as? Value.Double)?.value ?: return@NativeFunction Value.Null
                    val y = (args.getOrNull(1) as? Value.Double)?.value ?: return@NativeFunction Value.Null
                    val z = (args.getOrNull(2) as? Value.Double)?.value ?: return@NativeFunction Value.Null
                    entity.teleport(org.bukkit.Location(entity.world, x, y, z))
                    Value.Null
                },
                "raw" to Value.NativeFunction { _ -> Value.JavaObject(entity) }
            )
        )
        return Value.Instance(descriptor, mutableMapOf())
    }
}
```

- [ ] **Step 2: Write PlayerClass.kt**

```kotlin
package org.inklang.paper.classes

import org.bukkit.Material
import org.bukkit.entity.Player
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object PlayerClass {

    fun create(player: Player, bridge: org.inklang.paper.PaperBridge? = null): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "Player",
            superClass = null,
            readOnly = false,
            methods = mapOf(
                // Inventory
                "give" to Value.NativeFunction { args ->
                    // Accept either an ItemClass Instance or (material, count)
                    val itemArg = args.getOrNull(0) ?: return@NativeFunction Value.Null
                    val stack = when (itemArg) {
                        is Value.JavaObject -> itemArg.obj as? org.bukkit.inventory.ItemStack
                        is Value.String -> {
                            val count = (args.getOrNull(1) as? Value.Int)?.value ?: 1
                            val mat = Material.matchMaterial(itemArg.value.uppercase()) ?: return@NativeFunction Value.Null
                            org.bukkit.inventory.ItemStack(mat, count)
                        }
                        is Value.Instance -> {
                            val rawMethod = itemArg.clazz.methods["raw"]
                            if (rawMethod is Value.NativeFunction) {
                                (rawMethod.fn(listOf()) as? Value.JavaObject)?.obj as? org.bukkit.inventory.ItemStack
                            } else null
                        }
                        else -> null
                    } ?: return@NativeFunction Value.Null
                    player.inventory.addItem(stack)
                    Value.Null
                },
                "clearInventory" to Value.NativeFunction { _ -> player.inventory.clear(); Value.Null },
                "hasItem" to Value.NativeFunction { args ->
                    val material = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Boolean(false)
                    val mat = Material.matchMaterial(material.uppercase()) ?: return@NativeFunction Value.Boolean(false)
                    Value.Boolean(player.inventory.contains(mat))
                },
                "inventory" to Value.NativeFunction { _ -> InventoryClass.create(player.inventory) },
                // Permissions
                "has_permission" to Value.NativeFunction { args ->
                    val node = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Boolean(false)
                    Value.Boolean(player.hasPermission(node))
                },
                // Teams
                "join_team" to Value.NativeFunction { args ->
                    val teamName = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val sb = org.bukkit.Bukkit.getScoreboardManager()?.mainScoreboard ?: return@NativeFunction Value.Null
                    val team = sb.getTeam(teamName) ?: return@NativeFunction Value.Null
                    team.addEntry(player.name)
                    // Trigger on_join handler if registered
                    bridge?.teamRegistry?.get(teamName)?.triggerHandler("on_join", Value.JavaObject(player))
                    Value.Null
                },
                "leave_team" to Value.NativeFunction { args ->
                    val teamName = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val sb = org.bukkit.Bukkit.getScoreboardManager()?.mainScoreboard ?: return@NativeFunction Value.Null
                    val team = sb.getTeam(teamName) ?: return@NativeFunction Value.Null
                    team.removeEntry(player.name)
                    // Trigger on_leave handler if registered
                    bridge?.teamRegistry?.get(teamName)?.triggerHandler("on_leave", Value.JavaObject(player))
                    Value.Null
                },
                // Teleport
                "teleport_to" to Value.NativeFunction { args ->
                    val x = (args.getOrNull(0) as? Value.Double)?.value ?: return@NativeFunction Value.Null
                    val y = (args.getOrNull(1) as? Value.Double)?.value ?: return@NativeFunction Value.Null
                    val z = (args.getOrNull(2) as? Value.Double)?.value ?: return@NativeFunction Value.Null
                    player.teleport(org.bukkit.Location(player.world, x, y, z))
                    Value.Null
                },
                // Messaging
                "send_title" to Value.NativeFunction { args ->
                    val title = (args.getOrNull(0) as? Value.String)?.value ?: ""
                    val subtitle = (args.getOrNull(1) as? Value.String)?.value ?: ""
                    player.sendTitle(title, subtitle, 10, 70, 20)
                    Value.Null
                },
                // Raw access for java.call() FFI
                "raw" to Value.NativeFunction { _ -> Value.JavaObject(player) }
            )
        )
        return Value.Instance(descriptor, mutableMapOf())
    }
}
```

- [ ] **Step 3: Write ServerClass.kt**

```kotlin
package org.inklang.paper.classes

import org.bukkit.Bukkit
import org.bukkit.Server
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object ServerClass {

    fun create(server: Server): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "Server",
            superClass = null,
            readOnly = true,
            methods = mapOf(
                "broadcast" to Value.NativeFunction { args ->
                    val message = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val perm = args.getOrNull(1) as? Value.String
                    if (perm != null) {
                        server.broadcast(message, perm.value)
                    } else {
                        server.broadcastMessage(message)
                    }
                    Value.Null
                },
                "get_player" to Value.NativeFunction { args ->
                    val name = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val player = server.getPlayer(name) ?: return@NativeFunction Value.Null
                    Value.JavaObject(player)
                },
                "console_command" to Value.NativeFunction { args ->
                    val cmd = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd)
                    Value.Null
                },
                "raw" to Value.NativeFunction { _ -> Value.JavaObject(server) }
            )
        )
        return Value.Instance(descriptor, mutableMapOf())
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/classes/
git commit -m "feat(ink.paper): add EntityClass, PlayerClass, ServerClass descriptors"
```

---

## Chunk 10: Wire Up World Injection to Existing Executors

### Task 14: Add world global injection to MobExecutor, PlayerExecutor, CommandExecutor

**Files:**
- Modify: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/MobExecutor.kt`
- Modify: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PlayerExecutor.kt`

- [ ] **Step 1: In MobExecutor.kt, add `world` import and injection**

Add import at the top:
```kotlin
import org.inklang.paper.classes.WorldClass
```

In `MobListener.fire()`, add `world` to every globals map. For `onSpawn`:
```kotlin
fun onSpawn(event: EntitySpawnEvent) {
    if (event.entity.type != entityType) return
    fire("on_spawn", mapOf("entity" to Value.JavaObject(event.entity), "world" to WorldClass.create(event.entity.world)))
}
```

Apply the same pattern to all event handlers in `MobListener` — add `"world" to WorldClass.create(event.entity.world)` (or `event.entity.world` for non-spawn events that reference different entities).

- [ ] **Step 2: In PlayerExecutor.kt, add `world` injection**

Add import:
```kotlin
import org.inklang.paper.classes.WorldClass
```

In `PlayerListener.fire()`, add world to globals. For all events:
```kotlin
globals + ("world" to WorldClass.create(event.player.world))
```

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/MobExecutor.kt tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PlayerExecutor.kt
git commit -m "feat(ink.paper): inject world global into mob and player handlers"
```

---

## Chunk 11: Build and Integration Test

### Task 15: Build the JAR

**Files:** None (build only)

- [ ] **Step 1: Build the ink.paper runtime JAR**

Run: `cd tests/fixtures/ink.paper/runtime/paper && ./gradlew jar`
Expected: `BUILD SUCCESSFUL`, JAR at `build/libs/ink-paper-0.1.0.jar`

- [ ] **Step 2: Commit build verification**

If any fixes were needed to compile, commit them:
```bash
git add -A tests/fixtures/ink.paper/runtime/paper/src/
git commit -m "fix(ink.paper): compilation fixes for new executors and classes"
```

### Task 16: Update ink-package.toml version

**Files:**
- Modify: `tests/fixtures/ink.paper/ink-package.toml`

- [ ] **Step 1: Bump version to 0.2.0**

```toml
[package]
name = "ink.paper"
version = "0.2.0"
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/ink-package.toml
git commit -m "chore(ink.paper): bump version to 0.2.0"
```
