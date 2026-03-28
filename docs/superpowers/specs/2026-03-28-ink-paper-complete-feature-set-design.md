# ink.paper Complete Feature Set

## Problem

ink.paper v0.1.0 provides `mob`, `player`, and `command` declarations with event handlers. This covers basic event-driven scripting but omits the features a real Paper plugin needs: scheduled tasks, config management, permissions, scoreboards/teams, world manipulation, inventory/items, and persistence.

## Solution

Extend ink.paper with:

1. **New grammar declarations** for event-driven features (tasks, config, scoreboard, team, region)
2. **Enhanced class descriptors** on existing globals (`player`, `world`, `server`) for action-oriented features (inventory, permissions, world manipulation)
3. **New class descriptors** for complex objects (`Item`, `Inventory`, `Location`)

World manipulation already has a spec (`2026-03-28-ink-paper-world-manipulation-design.md`). This spec supersedes it and absorbs its content.

## Architecture

Two layers:

- **Grammar layer** (`src/grammar.ts` + `runtime/paper/src/main/kotlin/`) — new declaration keywords and their executor classes
- **Runtime layer** (Kotlin class descriptors) — new methods on `PlayerClass`, `ServerClass`, `WorldClass`, plus new `ItemClass`, `InventoryClass`

No compiler changes needed. The grammar API's existing primitives (`declaration`, `rule`, `seq`, `keyword`, `string`, `int`, `float`, `block`) cover all new declarations.

---

## Feature 1: Scheduled Tasks

### Grammar

New declaration: `task`

```
task CleanupTask {
    every 6000 ticks {
        // runs every 6000 ticks (5 minutes)
    }
    delay 200 ticks {
        // runs once after 200 ticks
    }
}
```

**Grammar rules:**

| Rule | Pattern | Handler |
|---|---|---|
| `every_clause` | `seq(keyword('every'), int(), keyword('ticks'), block())` | `"every"` |
| `delay_clause` | `seq(keyword('delay'), int(), keyword('ticks'), block())` | `"delay"` |

**Declaration definition:**

```typescript
declaration({
  keyword: 'task',
  rules: [
    rule('every_clause', r => r.seq(r.keyword('every'), r.int(), r.keyword('ticks'), r.block()), 'every'),
    rule('delay_clause', r => r.seq(r.keyword('delay'), r.int(), r.keyword('ticks'), r.block()), 'delay'),
  ]
})
```

### Runtime: `TaskExecutor`

- `activate()`: Reads CST for `every_clause` and `delay_clause` matches. Extracts tick count from `TokenMatch(int)` and function index from `FunctionBlock`. Registers `BukkitRunnable` with the Bukkit scheduler.
- `every` → `runTaskTimer(plugin, delay, period)` where both are the tick count
- `delay` → `runTaskLater(plugin, delay)` runs once
- `deactivate()`: Cancels all scheduled tasks. Stores task IDs in a list for cleanup.
- `handleEvent()`: Not used (tasks have no events).

**Globals injected:** `server`, `world` (from the first world).

**Task names** are used for identification in logging and `/ink tasks` debugging. They do not need to be globally unique — multiple `task` declarations can coexist.

---

## Feature 2: Commands (Enhanced)

### Grammar

The existing `command` declaration gains new clauses:

```
command Warp {
    permission "warp.use"
    aliases ["w", "tp"]
    on_execute {
        let dest = args[0]
        java.call(player, "sendMessage", "Warping to " + dest)
    }
}
```

**New grammar rules:**

| Rule | Pattern | Notes |
|---|---|---|
| `permission_clause` | `seq(keyword('permission'), string())` | Optional permission node |
| `aliases_clause` | `seq(keyword('aliases'), block())` | Block returns an array of strings |
| `on_execute_clause` | `seq(keyword('on_execute'), block())` | Handler (replaces existing `command_clause`) |

The existing `command_clause` (bare `block()` with no keyword prefix) is kept for backwards compatibility. `on_execute` is the preferred form going forward.

**Updated declaration:**

```typescript
declaration({
  keyword: 'command',
  rules: [
    rule('on_execute_clause', r => r.seq(r.keyword('on_execute'), r.block()), 'on_execute'),
    rule('command_clause', r => r.block(), 'on_execute'),  // backwards compat
    rule('permission_clause', r => r.seq(r.keyword('permission'), r.string()), 'permission'),
    rule('aliases_clause', r => r.seq(r.keyword('aliases'), r.block()), 'aliases'),
  ]
})
```

### Runtime: `CommandExecutor` (enhanced)

- Read `permission_clause` from CST. If present, set `command.setPermission(value)` on the registered `PluginCommand`.
- Read `aliases_clause` from CST. The block compiles to a function that returns an Ink Array — extract string values and set `command.setAliases(list)`.
- `on_execute` handler receives globals: `sender` (Player or ConsoleCommandSender), `args` (Ink Array of strings), `world` (WorldClass instance, null if console sender).

---

## Feature 3: Config Files

### Grammar

New declaration: `config`

```
config DungeonConfig {
    file "dungeon_config.yml"
    default_difficulty = "normal"
    max_players = 10
    respawn_time = 30
    debug = false
}
```

**Grammar rules:**

| Rule | Pattern | Handler |
|---|---|---|
| `file_clause` | `seq(keyword('file'), string())` | `"file"` |
| `config_entry_clause` | `seq(identifier(), literal('='), choice(string(), int(), float(), keyword('true'), keyword('false')))` | `"config_entry"` |

The `config_entry_clause` pattern is: `identifier = value` where value is a string, int, float, or boolean literal.

**Declaration definition:**

```typescript
declaration({
  keyword: 'config',
  rules: [
    rule('file_clause', r => r.seq(r.keyword('file'), r.string()), 'file'),
    rule('config_entry_clause', r => r.seq(r.identifier(), r.literal('='), r.choice(r.string(), r.int(), r.float(), r.keyword('true'), r.keyword('false'))), 'config_entry'),
  ]
})
```

### Runtime: `ConfigExecutor`

- `activate()`:
  1. Reads `file_clause` from CST for the filename (default: `<declarationName>.yml`)
  2. Reads all `config_entry_clause` matches to extract default values (key-value pairs from TokenMatches)
  3. Looks for the file in the Ink plugin's `configs/` data folder
  4. If file doesn't exist, writes defaults as YAML
  5. If file exists, loads it and merges with defaults (missing keys get default values)
  6. Registers a global with the declaration name (e.g. `DungeonConfig`) as a `Value.Instance` with a `ConfigClass` descriptor

**`ConfigClass` descriptor:**

| Property/Method | Type | Notes |
|---|---|---|
| `get(key)` | any | Get config value |
| `set(key, value)` | null | Set config value (in memory only) |
| `save()` | null | Write current values to YAML file |
| `reload()` | null | Re-read from file, replacing in-memory values |
| Direct property access | any | `DungeonConfig.max_players` reads from the config map |

Direct property access works via `GET_FIELD` on the `Value.Instance` — the ConfigExecutor stores all config values as fields on the instance. `SET_FIELD` writes to the in-memory map but does not auto-save.

**Usage in scripts:**

```ink
// Read config
let max = DungeonConfig.max_players

// Modify config (in memory)
DungeonConfig.max_players = 20

// Persist changes
DungeonConfig.save()
```

**Thread safety:** Config reads/writes are not thread-safe. Since Ink handlers run on the main thread, this is safe for synchronous handlers. If async handlers are added later, config access must be synchronized.

---

## Feature 4: Permissions

Permissions are not a grammar declaration — they are methods on the `PlayerClass` descriptor. This avoids over-engineering and keeps permissions inline with existing player operations.

### PlayerClass Permission Methods

| Method | Returns | Notes |
|---|---|---|
| `has_permission(node)` | bool | Check if player has permission |
| `add_permission(node)` | null | Add permission (requires Vault or LuckPerms API) |
| `remove_permission(node)` | null | Remove permission |

### Implementation

- `has_permission` maps to Bukkit's `player.hasPermission(node)` — no additional plugin dependency.
- `add_permission` and `remove_permission` require a permissions plugin. The runtime checks for Vault's `Permission` interface at startup. If Vault is not present, these methods throw a `ScriptException` with a clear message: `"Permissions modification requires Vault. Install Vault or a compatible permissions plugin."`

### Usage

```ink
if player.has_permission("dungeon.admin") {
    // admin-only logic
}
```

### Command integration

The enhanced `command` declaration's `permission` clause (see Feature 2) uses Bukkit's built-in command permission system. No Vault dependency needed for command permissions.

---

## Feature 5: Scoreboard and Teams

### Grammar

Two new declarations: `scoreboard` and `team`.

```
scoreboard DungeonScores {
    objective "kills" {
        criteria "playerKillCount"
        display "Player Kills"
    }
    objective "deaths" {
        criteria "playerDeathCount"
        display "Deaths"
    }
}

team RedTeam {
    prefix "[Red] "
    suffix " "
    friendly_fire false
    on_join {
        java.call(player, "sendMessage", "You joined Red Team!")
    }
    on_leave {
        java.call(player, "sendMessage", "You left Red Team.")
    }
}
```

**Scoreboard grammar rules:**

| Rule | Pattern | Handler |
|---|---|---|
| `objective_clause` | `seq(keyword('objective'), string(), block())` | `"objective"` |
| `criteria_clause` | `seq(keyword('criteria'), string())` | `"criteria"` |
| `display_clause` | `seq(keyword('display'), string())` | `"display"` |

**Team grammar rules:**

| Rule | Pattern | Handler |
|---|---|---|
| `prefix_clause` | `seq(keyword('prefix'), string())` | `"prefix"` |
| `suffix_clause` | `seq(keyword('suffix'), string())` | `"suffix"` |
| `friendly_fire_clause` | `seq(keyword('friendly_fire'), choice(keyword('true'), keyword('false')))` | `"friendly_fire"` |
| `on_join_clause` | `seq(keyword('on_join'), block())` | `"on_join"` |
| `on_leave_clause` | `seq(keyword('on_leave'), block())` | `"on_leave"` |

### Runtime: `ScoreboardExecutor`

- `activate()`:
  1. Creates a Bukkit `Scoreboard` (or gets the server main scoreboard)
  2. For each `objective_clause`, creates a Bukkit `Objective` with the given name
  3. Reads `criteria_clause` for the criteria type (default: `"dummy"`)
  4. Reads `display_clause` for the display name (default: objective name)
  5. Registers the scoreboard globally

- Exposes a `ScoreboardClass` instance as a global with the declaration name. Methods:

| Method | Returns | Notes |
|---|---|---|
| `get_score(player, objective)` | int | Get player's score |
| `set_score(player, objective, value)` | null | Set player's score |
| `add_score(player, objective, amount)` | null | Add to player's score |

### Runtime: `TeamExecutor`

- `activate()`:
  1. Creates a Bukkit `Team` on the main scoreboard
  2. Reads `prefix_clause`, `suffix_clause`, `friendly_fire_clause` from CST and applies to the team
  3. For `on_join` / `on_leave`, no Bukkit events exist for team changes — these handlers are called programmatically when `player.join_team(name)` or `player.leave_team(name)` is called (see PlayerClass extensions below)

- `deactivate()`: Unregisters the team from the scoreboard.
- Exposes the team name as a string global for use with player methods.

### PlayerClass Team Methods

| Method | Returns | Notes |
|---|---|---|
| `join_team(team_name)` | null | Add player to team. Triggers team's `on_join` handler if defined. |
| `leave_team(team_name)` | null | Remove player from team. Triggers team's `on_leave` handler if defined. |

**Note:** `on_join` / `on_leave` on teams are not Bukkit events — they are callbacks triggered by `join_team` / `leave_team` method calls. The TeamExecutor registers itself with a registry so PlayerClass can look up and trigger handlers.

---

## Feature 6: World Manipulation

*Absorbed from `2026-03-28-ink-paper-world-manipulation-design.md`.*

### `WorldClass` Descriptor (enhanced)

**Properties (get/set):**

| Property | Type | Notes |
|---|---|---|
| `time` | int | Game ticks (0-24000) |
| `weather` | string | "clear", "rain", "thunder" |
| `difficulty` | string | "peaceful", "easy", "normal", "hard" |
| `pvp` | bool | |

**Properties (read-only):**

| Property | Type | Notes |
|---|---|---|
| `name` | string | World name |
| `seed` | int | Truncated to 32-bit |
| `environment` | string | "normal", "nether", "the_end" |

**Methods:**

| Method | Returns | Notes |
|---|---|---|
| `getBlock(x, y, z)` | Block | Snapshot of block at coordinates |
| `setBlock(x, y, z, material)` | null | Set block type |
| `getBiome(x, y, z)` | string | Biome name |
| `setBiome(x, y, z, biome)` | null | Set biome |
| `getHeight(x, z)` | int | Highest non-air block Y |
| `spawnEntity(type, x, y, z)` | Entity | Spawn entity, returns EntityClass instance |
| `dropItem(x, y, z, item)` | Entity | Drop an ItemStack at location |
| `createExplosion(x, y, z, power)` | null | Create explosion |

### `BlockClass` Descriptor

Read-only snapshot.

| Property | Type | Notes |
|---|---|---|
| `type` | string | Material name |
| `x`, `y`, `z` | int | Coordinates |
| `biome` | string | Biome name |
| `light` | int | Block light level (0-15) |
| `isAir` | bool | |
| `isLiquid` | bool | |
| `isSolid` | bool | |

### EntityClass Transition

Mob handlers currently inject `entity` as `Value.JavaObject`. Transition to `Value.Instance` using an `EntityClass` descriptor:

**Properties (get/set):** `x`, `y`, `z` (float), `health` (float, living entities only)
**Properties (read-only):** `type` (string), `isAlive` (bool), `world` (string)
**Methods:** `remove()`, `teleport(x, y, z)`, `kill()`

### Handler Injection

Add `world` global to all three existing executors:
- `MobExecutor`: `globals["world"] = WorldClass.create(event.entity.world)`
- `PlayerExecutor`: `globals["world"] = WorldClass.create(event.player.world)`
- `CommandExecutor`: `globals["world"] = WorldClass.create((sender as Player).world)`

### Thread Safety

All Bukkit API calls run on the main server thread. Ink event handlers execute synchronously on the main thread, so no additional scheduling needed.

### Block Material Strings

`setBlock` accepts `"stone"` (uppercased and matched) or `"minecraft:stone"` (namespace stripped, then matched). Invalid materials throw `ScriptException`.

---

## Feature 7: Inventory and Items

Items and inventory are class descriptors on existing globals — no grammar declarations needed.

### `ItemClass` Descriptor

Created via `world.createItem(material)` or `world.createItem(material, count)`.

| Property/Method | Type | Notes |
|---|---|---|
| `type` | string (read-only) | Material name |
| `count` | int (get/set) | Stack size |
| `name` | string (get/set) | Custom display name |
| `lore` | Array (get/set) | Lore lines |
| `enchant(enchantment, level)` | null | Add enchantment |
| `isUnbreakable` | bool (get/set) | |

**Factory method on WorldClass:**

| Method | Returns | Notes |
|---|---|---|
| `createItem(material)` | Item | Create single item |
| `createItem(material, count)` | Item | Create stacked item |

### PlayerClass Inventory Methods

| Method | Returns | Notes |
|---|---|---|
| `give(item)` | null | Give item to player |
| `give(material, count)` | null | Shorthand for simple items |
| `clearInventory()` | null | Clear all inventory slots |
| `hasItem(material)` | bool | Check if player has at least one of material |
| `getItem(hand)` | Item | Get item in hand (`"main"` or `"off"`, default `"main"`) |

### `InventoryClass` Descriptor

Accessed via `player.inventory`.

| Property/Method | Type | Notes |
|---|---|---|
| `size` | int (read-only) | Total slots |
| `getItem(slot)` | Item | Get item at slot index |
| `setItem(slot, item)` | null | Set item at slot index |
| `clear(slot)` | null | Clear specific slot (or all if no arg) |
| `contains(material)` | bool | Check if inventory contains material |

### Usage

```ink
// Create and give a custom sword
let sword = world.createItem("diamond_sword")
sword.name = "Blade of Shadows"
sword.enchant("sharpness", 5)
sword.isUnbreakable = true
player.give(sword)

// Check inventory
if player.hasItem("diamond") {
    java.call(player, "sendMessage", "You have diamonds!")
}
```

---

## Feature 8: Database / Persistence

The existing `db` module in the Ink runtime provides:

- `db.from("table")` — query builder
- `db.registerTable("name", schema)` — register table schema
- CRUD operations via the query builder
- Data stored as JSON in the plugin's data folder

### What's Already Working

```ink
// Register a table
db.registerTable("dungeon_runs", {
    player: "string",
    dungeon: "string",
    time_seconds: "int",
    completed: "bool"
})

// Insert
db.from("dungeon_runs").insert({
    player: player.name,
    dungeon: "ShadowCrypt",
    time_seconds: 120,
    completed: true
})

// Query
let runs = db.from("dungeon_runs").where("player", player.name).findAll()
```

### Enhancements

Minor additions to the existing `DbModule`:

| Method | Returns | Notes |
|---|---|---|
| `db.save()` | null | Force-write all tables to disk |
| `db.table("name").count()` | int | Count rows |
| `db.table("name").deleteWhere("key", value)` | int | Delete matching rows, returns count |

These are small additions to the existing `TableRuntime` / `QueryBuilderInstance` — no new architecture.

---

## Feature 9: Regions (Bonus — Dungeon Support)

Enables dungeon/area triggers based on player location.

### Grammar

New declaration: `region`

```
region ShadowCrypt {
    world "world"
    min -100, 0, -200
    max 100, 64, 200
    on_enter {
        java.call(player, "sendMessage", "You enter the Shadow Crypt...")
    }
    on_leave {
        java.call(player, "sendMessage", "You leave the Shadow Crypt.")
    }
}
```

**Grammar rules:**

| Rule | Pattern | Handler |
|---|---|---|
| `world_clause` | `seq(keyword('world'), string())` | `"world"` |
| `min_clause` | `seq(keyword('min'), int(), literal(','), int(), literal(','), int())` | `"min"` |
| `max_clause` | `seq(keyword('max'), int(), literal(','), int(), literal(','), int())` | `"max"` |
| `on_enter_clause` | `seq(keyword('on_enter'), block())` | `"on_enter"` |
| `on_leave_clause` | `seq(keyword('on_leave'), block())` | `"on_leave"` |

### Runtime: `RegionExecutor`

- `activate()`:
  1. Reads `world_clause`, `min_clause`, `max_clause` to define a bounding box (axis-aligned)
  2. Starts a `BukkitRunnable` that runs every 20 ticks (1 second)
  3. Each tick: checks all online players' positions against the bounding box
  4. Tracks which players are inside the region
  5. When a player enters: fires `on_enter` handler with `player` global
  6. When a player leaves: fires `on_leave` handler with `player` global

- `deactivate()`: Cancels the polling task.

**Performance:** Polling every 20 ticks is cheap for small player counts (< 100). For large servers, consider switching to chunk events in the future. The polling approach is simple, correct, and sufficient for v0.2.0.

**Globals injected:** `player`, `world`, `server`.

---

## Updated Grammar Summary

All declarations in ink.paper v0.2.0:

| Declaration | Keyword | Clauses | Status |
|---|---|---|---|
| mob | `mob` | on_spawn, on_death, on_damage, on_tick, on_target, on_interact | Existing |
| player | `player` | on_join, on_leave, on_chat | Existing |
| command | `command` | on_execute, permission, aliases | Enhanced |
| task | `task` | every, delay | **New** |
| config | `config` | file, config_entry (= values) | **New** |
| scoreboard | `scoreboard` | objective (criteria, display) | **New** |
| team | `team` | prefix, suffix, friendly_fire, on_join, on_leave | **New** |
| region | `region` | world, min, max, on_enter, on_leave | **New** |

All new keywords added to the grammar's `keywords` array for the tokenizer.

## Updated Runtime Summary

### New Executors

| Executor | Declaration | Bukkit Integration |
|---|---|---|
| `TaskExecutor` | task | BukkitRunnable scheduler |
| `ConfigExecutor` | config | YAML file I/O |
| `ScoreboardExecutor` | scoreboard | Bukkit Scoreboard API |
| `TeamExecutor` | team | Bukkit Team API |
| `RegionExecutor` | region | BukkitRunnable position polling |

### Enhanced Class Descriptors

| Class | New Methods/Properties |
|---|---|
| `WorldClass` | getBlock, setBlock, spawnEntity, dropItem, createExplosion, createItem, time/weather/difficulty/pvp setters |
| `PlayerClass` | give, hasItem, getItem, clearInventory, has_permission, add_permission, remove_permission, join_team, leave_team, inventory property |
| `ServerClass` | broadcast, get_player, run_task, run_every, cancel_task, console_command |
| `EntityClass` | Transition from JavaObject to Instance with typed properties |
| `BlockClass` | **New** — read-only block snapshot |
| `ItemClass` | **New** — item builder with enchant/name/lore |
| `InventoryClass` | **New** — slot-based inventory access |
| `ConfigClass` | **New** — config file wrapper with get/set/save/reload |

### PaperBridge Updates

`blockTypes` list expands from `["mob", "player", "command"]` to `["mob", "player", "command", "task", "config", "scoreboard", "team", "region"]`.

`createExecutor()` routes each block type to its executor class.

## File Structure

### Grammar

```
tests/fixtures/ink.paper/src/grammar.ts   — updated with all new declarations
```

### Runtime (Kotlin)

```
tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/
  PaperBridge.kt          — updated blockTypes + routing
  MobExecutor.kt          — updated: world global injection, EntityClass wrapping
  PlayerExecutor.kt       — updated: world global injection
  CommandExecutor.kt      — updated: permission, aliases, world global
  TaskExecutor.kt         — new
  ConfigExecutor.kt       — new
  ScoreboardExecutor.kt   — new
  TeamExecutor.kt         — new
  RegionExecutor.kt       — new
  classes/
    WorldClass.kt         — new: world descriptor with all methods
    BlockClass.kt         — new: block snapshot descriptor
    EntityClass.kt        — new: entity instance descriptor (replaces JavaObject injection)
    PlayerClass.kt        — new: enhanced player descriptor with inventory/permissions/teams
    ItemClass.kt          — new: item builder descriptor
    InventoryClass.kt     — new: inventory descriptor
    ConfigClass.kt        — new: config file descriptor
    ServerClass.kt        — new: enhanced server descriptor with broadcast/scheduler
```

### Globals Registration

A new `PaperGlobals.kt` (or extension of `BukkitRuntimeRegistrar`) registers all class descriptors:
- `world` → `WorldClass.create(server.worlds[0])`
- `server` → `ServerClass.create(server)`
- Existing `player` and `entity` globals remain handler-injected (context-dependent)

## Scope

### In Scope (v0.2.0)

- All 5 new declarations (task, config, scoreboard, team, region)
- Enhanced command declaration (permission, aliases)
- World manipulation (blocks, biomes, entity spawning, properties)
- Inventory and items (create, give, check, modify)
- Permissions (check via Bukkit, modify via Vault if present)
- Database enhancements (save, count, deleteWhere)
- Region-based enter/leave triggers

### Out of Scope (Future)

- Block events (on_block_break, on_block_place) — needs grammar + new Bukkit listeners
- Entity equipment/potion effects on spawn
- Chunk loading/unloading
- Particle/sound effects
- Bulk block operations (fill, replace)
- NPC/dialogue system
- Boss bars
- Advancements
- World generation
- Transitive package dependencies
- Hot-reload (`/ink reload`)
