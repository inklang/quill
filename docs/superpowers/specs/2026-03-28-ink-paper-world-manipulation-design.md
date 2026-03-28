# ink.paper World Manipulation API

## Problem

The ink.paper grammar provides event handlers (`mob`, `player`, `command`) but no way for scripts to read or modify the Minecraft world. Scripts can react to events but cannot place blocks, query biomes, change weather, or spawn entities programmatically.

## Solution

Expose a rich `world` global object in the ink.paper runtime, implemented as a `Value.Instance` with `NativeFunction` property accessors and methods. No grammar changes required — this is purely Kotlin runtime work.

## API

### `world` — Global Instance

Must be injected into all handler contexts (mob, player, command). Currently only the legacy bukkit runtime injects `world` (as `Value.JavaObject`). The ink.paper runtime (`MobExecutor.kt`, `PlayerExecutor.kt`, `CommandExecutor.kt`) does not inject it yet — this spec requires adding `world` injection to all three executors.

Wrapped as a `Value.Instance` with a `WorldClass` descriptor, delegating to the underlying Bukkit `World` object.

**Properties (get/set):**

| Property | Type | Read | Write | Notes |
|---|---|---|---|---|
| `time` | int | yes | yes | Game ticks (0-24000) |
| `weather` | string | yes | yes | "clear", "rain", "thunder" |
| `difficulty` | string | yes | yes | "peaceful", "easy", "normal", "hard" |
| `pvp` | bool | yes | yes | |

**Properties (read-only):**

| Property | Type | Notes |
|---|---|---|
| `name` | string | World name |
| `seed` | int | World seed (truncated to 32-bit from Bukkit's Long) |
| `environment` | string | "normal", "nether", "the_end" |

**Methods:**

| Method | Returns | Notes |
|---|---|---|
| `getBlock(x, y, z)` | Block | Snapshot of block at coordinates |
| `setBlock(x, y, z, material)` | null | Set block type. Accepts `"stone"` or `"minecraft:stone"` |
| `getBiome(x, y, z)` | string | Biome name at coordinates |
| `setBiome(x, y, z, biome)` | null | Set biome at coordinates |
| `getHeight(x, z)` | int | Highest non-air block Y at column |
| `spawnEntity(type, x, y, z)` | Entity | Spawn entity, returns instance |

**Usage:**

```ink
// Read world state
let b = world.getBlock(100, 64, -50)
print(b.type)  // "STONE"

// Modify world
world.setBlock(100, 65, -50, "stone")

// Properties
print(world.time)
world.time = 1000
world.weather = "rain"
world.difficulty = "hard"

// Queries
let biome = world.getBiome(100, 64, -50)
let y = world.getHeight(100, -50)

// Spawn
let zombie = world.spawnEntity("zombie", 100, 64, -50)
zombie.health = 20
```

### `Block` — Instance returned by `world.getBlock(...)`

Read-only snapshot of block state at time of access. Mutate blocks via `world.setBlock(...)`.

**Properties (read-only):**

| Property | Type | Notes |
|---|---|---|
| `type` | string | Material name (e.g. "STONE") |
| `x` | int | X coordinate |
| `y` | int | Y coordinate |
| `z` | int | Z coordinate |
| `biome` | string | Biome name |
| `light` | int | Combined light level (block-emitted light, 0-15). Does not include sky light. |
| `isAir` | bool | |
| `isLiquid` | bool | |
| `isSolid` | bool | |

### `Entity` — Instance returned by `world.spawnEntity(...)` and handlers

Currently mob handlers inject `entity` as `Value.JavaObject(event.entity)`. This spec proposes transitioning entities to `Value.Instance` wrapping (using an `EntityClass` descriptor). This changes how scripts interact with entities — instead of raw Java field/method access, they use the typed property/method API below. Existing scripts using JavaObject-style access will need to be updated.

**Properties (get/set):**

| Property | Type | Read | Write | Notes |
|---|---|---|---|---|
| `x` | float | yes | yes | Teleport shortcut (sub-block precision) |
| `y` | float | yes | yes | |
| `z` | float | yes | yes | |
| `health` | float | yes | yes | Living entities only |

**Properties (read-only):**

| Property | Type | Notes |
|---|---|---|
| `type` | string | Entity type name |
| `isAlive` | bool | |
| `world` | string | World name |

**Methods:**

| Method | Returns | Notes |
|---|---|---|
| `remove()` | null | Despawn the entity |
| `teleport(x, y, z)` | null | Move to coordinates (atomic — single Bukkit teleport call). Prefer this over setting x/y/z individually, which triggers three separate teleports. |
| `kill()` | null | Kill the entity |

**Note on coordinate setters:** Setting `entity.x`, `entity.y`, or `entity.z` individually calls Bukkit's `teleport()` for each assignment. For atomic position changes, use `entity.teleport(x, y, z)` to avoid three separate teleport operations.

## Implementation

### Where

Kotlin runtime code in the ink.paper package:
- `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/` in quill
- Mirrored in the ink repo's paper module

### Components

1. **`WorldClass`** — Builds a `ClassDescriptor` for the `world` instance. Each property maps to a `NativeFunction` that reads/writes through the Bukkit `World` object stored in a closure. The descriptor is marked writable (not `readOnly`) to allow `SET_FIELD`.

2. **`BlockClass`** — Builds a `ClassDescriptor` for Block instances. Captures the Bukkit `Block` state at creation time (true snapshot — reads the Bukkit block once and stores values in instance fields). If the underlying block changes after creation, the Ink Block instance retains its original values. All fields are set once and the descriptor is marked `readOnly`.

3. **Entity extension** — The existing `EntityClass` in the legacy bukkit runtime uses `Value.Double` for coordinates and health. The ink.paper runtime currently passes entities as `Value.JavaObject`. This spec proposes: (a) port `EntityClass` to the ink.paper runtime as a `Value.Instance` wrapper, (b) use `float` (Ink `Value.Double`) for coordinates and health consistent with existing conventions, (c) replace `Value.JavaObject(event.entity)` injection in `MobExecutor.kt` with the new `EntityClass` wrapping.

4. **Handler injection** — Add `world` global injection to all three ink.paper executors:
   - `MobExecutor.kt`: Add `globals["world"] = WorldClass.create(event.entity.world)` alongside existing `entity`, `damage`, etc.
   - `PlayerExecutor.kt`: Add `globals["world"] = WorldClass.create(event.player.world)`
   - `CommandExecutor.kt`: Add `globals["world"] = WorldClass.create(sender.world)` (sender must be a Player)

### Property setter approach

Writable properties on `world` (e.g. `world.time = 1000`) need to propagate writes back to the Bukkit API. The existing `SET_FIELD` opcode only writes to `obj.fields[name]`, with no callback mechanism.

**Recommended: Replace `SET_FIELD` with `SET_PROPERTY` globally.** This is a single opcode rename in the compiler (emit `SET_PROPERTY` instead of `SET_FIELD` everywhere). The VM handler for `SET_PROPERTY` checks for a `set_<prop>` method on the class descriptor; if found, it calls it (allowing the NativeFunction to delegate to Bukkit); otherwise it falls back to writing `obj.fields[name]` (preserving normal field assignment behavior). This gives all Ink classes computed-setter capability at zero cost to existing code.

**Fallback (v1):** If the VM change is deferred, use methods for writes and read-only properties: `world.getTime()` / `world.setTime(1000)`, with `world.time` as read-only.

### Thread safety

All Bukkit API calls (block sets, entity spawns, property writes) must run on the main server thread. Ink event handlers already execute synchronously on the main thread (Bukkit fires events on the main thread), so no additional scheduling is needed. However, if async handlers are added in the future, world manipulation calls will need to be wrapped in `Bukkit.getScheduler().runTask(...)`.

### Block material strings

`setBlock` accepts material names in two forms:
- Short: `"stone"`, `"oak_planks"` — uppercased and matched against `Material.values()`
- Namespaced: `"minecraft:stone"` — stripped of namespace, then matched

Invalid material names throw a `ScriptException` at runtime.

### Coordinates

All block coordinate parameters are `Int` (whole blocks). Entity coordinates and health use `float` (Ink `Value.Double`) for sub-block precision, consistent with existing `EntityClass` and `PlayerClass` conventions. Block coordinates must be in valid world range (Y -64 to 320 for overworld); out-of-range throws `ScriptException`.

## Scope

**In scope:**
- World properties (time, weather, difficulty, pvp)
- Block read/write
- Biome read/write
- Height query
- Entity spawn with basic position/health manipulation

**Out of scope (future):**
- Block events (on_block_break, on_block_place) — requires grammar changes
- Entity spawning with equipment/potion effects
- Inventory/container manipulation
- Chunk loading/unloading
- Particle/sound effects
- Bulk operations (fill, replace)
- Redstone/state queries
