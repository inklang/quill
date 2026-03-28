# ink.paper World Manipulation API

## Problem

The ink.paper grammar provides event handlers (`mob`, `player`, `command`) but no way for scripts to read or modify the Minecraft world. Scripts can react to events but cannot place blocks, query biomes, change weather, or spawn entities programmatically.

## Solution

Expose a rich `world` global object in the ink.paper runtime, implemented as a `Value.Instance` with `NativeFunction` property accessors and methods. No grammar changes required — this is purely Kotlin runtime work.

## API

### `world` — Global Instance

Available in all handler contexts. Wrapped as a `Value.Instance` with a `WorldClass` descriptor, delegating to the underlying Bukkit `World` object.

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
| `seed` | int | World seed |
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
| `light` | int | Block light level (0-15) |
| `isAir` | bool | |
| `isLiquid` | bool | |
| `isSolid` | bool | |

### `Entity` — Instance returned by `world.spawnEntity(...)` and handlers

**Properties (get/set):**

| Property | Type | Read | Write | Notes |
|---|---|---|---|---|
| `x` | int | yes | yes | Teleport shortcut |
| `y` | int | yes | yes | |
| `z` | int | yes | yes | |
| `health` | int | yes | yes | Living entities only |

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
| `teleport(x, y, z)` | null | Move to coordinates |
| `kill()` | null | Kill the entity |

## Implementation

### Where

Kotlin runtime code in the ink.paper package:
- `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/` in quill
- Mirrored in the ink repo's paper module

### Components

1. **`WorldClass`** — Builds a `ClassDescriptor` for the `world` instance. Each property maps to a `NativeFunction` that reads/writes through the Bukkit `World` object stored in a closure. The descriptor is marked writable (not `readOnly`) to allow `SET_FIELD`.

2. **`BlockClass`** — Builds a `ClassDescriptor` for Block instances. Captures the Bukkit `Block` reference at creation time. All fields are set once and the descriptor is marked `readOnly`.

3. **Entity extension** — Extend or supplement the existing `EntityClass` with position get/set and health get/set. Position writes call Bukkit's `teleport()` under the hood.

4. **`PaperBindings.kt` change** — Replace `globals["world"] = Value.JavaObject(world)` with `globals["world"] = WorldClass.create(bukkitWorld)`. The `create` function returns a `Value.Instance` with the `WorldClass` descriptor and the Bukkit world reference captured in closures.

### Property setter approach

Writable properties on `world` (e.g. `world.time = 1000`) use the existing `SET_FIELD` opcode. The `WorldClass` descriptor fields are pre-populated with `NativeFunction` values that, when read, return the current Bukkit value, and the `SET_FIELD` handler stores the new value. However, since `SET_FIELD` just writes to `obj.fields[name]`, we need a mechanism to sync writes back to Bukkit.

Options:
- **A)** Store a custom field map that intercepts writes and calls the Bukkit setter. This requires a small VM change to support custom field stores.
- **B)** Use methods only (`setTime(1000)`) and expose read-only properties. Simpler but less ergonomic.
- **C)** Wrap property writes as `NativeFunction` setters in the class descriptor. The VM's `SET_FIELD` writes to `obj.fields`, but we can add a `SET_PROPERTY` opcode that checks for setter methods on the class.

**Recommended: Option C** — Add a `SET_PROPERTY` opcode that looks up a setter method (convention: `set_<prop>`) on the class descriptor before falling back to field assignment. This is a small, targeted VM change that enables clean property syntax for all Ink classes.

If Option C is deferred, fall back to **Option B** (methods for writes, properties for reads) as a v1.

### Block material strings

`setBlock` accepts material names in two forms:
- Short: `"stone"`, `"oak_planks"` — uppercased and matched against `Material.values()`
- Namespaced: `"minecraft:stone"` — stripped of namespace, then matched

Invalid material names throw a `ScriptException` at runtime.

### Coordinates

All coordinate parameters are `Int`. The Ink VM's `Value.Int` maps directly to Kotlin `Int`. Block coordinates must be in valid world range (Y -64 to 320 for overworld); out-of-range throws `ScriptException`.

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
