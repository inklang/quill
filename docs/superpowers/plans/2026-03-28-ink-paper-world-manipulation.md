# ink.paper World Manipulation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fluent `world` manipulation API to the ink.paper runtime so Ink scripts can read/write blocks, query world properties, and spawn entities.

**Architecture:** Add three Kotlin class wrapper objects (`WorldClass`, `BlockClass`, `InkEntityClass`) to the ink.paper runtime. Inject `world` as a `Value.Instance` into all three executors (MobExecutor, PlayerExecutor, CommandExecutor). No grammar or quill CLI changes needed.

**Tech Stack:** Kotlin, Bukkit/Paper API, Ink VM (`Value.Instance`, `ClassDescriptor`, `NativeFunction`)

**Spec:** `docs/superpowers/specs/2026-03-28-ink-paper-world-manipulation-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/WorldClass.kt` | World property/method wrapper |
| Create | `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/BlockClass.kt` | Block snapshot wrapper |
| Create | `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/InkEntityClass.kt` | Entity wrapper (position, health, teleport) |
| Modify | `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/MobExecutor.kt` | Add `world` to globals injection |
| Modify | `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PlayerExecutor.kt` | Add `world` to globals injection |
| Modify | `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/CommandExecutor.kt` | Add `world` to globals injection |

Reference implementations in the ink repo (do NOT modify, use as pattern reference):
- `/c/Users/justi/dev/ink/ink-bukkit/src/main/kotlin/org/inklang/bukkit/runtime/WorldClass.kt`
- `/c/Users/justi/dev/ink/ink-bukkit/src/main/kotlin/org/inklang/bukkit/runtime/EntityClass.kt`
- `/c/Users/justi/dev/ink/ink-bukkit/src/main/kotlin/org/inklang/bukkit/runtime/PlayerClass.kt`

---

## Chunk 1: Class Wrappers

### Task 1: Create BlockClass.kt

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/BlockClass.kt`

- [ ] **Step 1: Create BlockClass.kt**

```kotlin
package org.inklang.paper

import org.bukkit.block.Block
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object BlockClass {
    fun wrap(block: Block): Value.Instance {
        // Snapshot: read Bukkit block state once at creation time
        val type = block.type.name
        val x = block.x
        val y = block.y
        val z = block.z
        val biome = block.biome?.name?.lowercase()?.replace("_", " ") ?: "unknown"
        val light = block.lightFromBlocks
        val isAir = block.type.isAir
        val isLiquid = block.type.isLiquid
        val isSolid = block.type.isSolid

        return Value.Instance(
            ClassDescriptor(
                name = "Block",
                superClass = null,
                readOnly = true,
                methods = mapOf(
                    "type" to Value.NativeFunction { Value.String(type) },
                    "x" to Value.NativeFunction { Value.Int(x) },
                    "y" to Value.NativeFunction { Value.Int(y) },
                    "z" to Value.NativeFunction { Value.Int(z) },
                    "biome" to Value.NativeFunction { Value.String(biome) },
                    "light" to Value.NativeFunction { Value.Int(light) },
                    "isAir" to Value.NativeFunction { Value.Boolean(isAir) },
                    "isLiquid" to Value.NativeFunction { Value.Boolean(isLiquid) },
                    "isSolid" to Value.NativeFunction { Value.Boolean(isSolid) }
                )
            )
        )
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/BlockClass.kt
git commit -m "feat(ink.paper): add BlockClass wrapper for block snapshots"
```

---

### Task 2: Create InkEntityClass.kt

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/InkEntityClass.kt`

- [ ] **Step 1: Create InkEntityClass.kt**

Follows the pattern from `/c/Users/justi/dev/ink/ink-bukkit/src/main/kotlin/org/inklang/bukkit/runtime/EntityClass.kt` but adapted for the ink.paper package (no `Server` parameter needed). Uses `Value.Double` for coordinates and health consistent with existing conventions.

```kotlin
package org.inklang.paper

import org.bukkit.attribute.Attribute
import org.bukkit.entity.Entity
import org.bukkit.entity.LivingEntity
import org.bukkit.Location
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object InkEntityClass {
    fun wrap(entity: Entity): Value.Instance {
        val methods = mutableMapOf<String, Value>(
            // Read-only properties
            "type" to Value.NativeFunction { Value.String(entity.type.name) },
            "isAlive" to Value.NativeFunction { Value.Boolean(!entity.isDead) },
            "world" to Value.NativeFunction { Value.String(entity.world.name) },

            // Position getters (double for sub-block precision)
            "x" to Value.NativeFunction { Value.Double(entity.location.x) },
            "y" to Value.NativeFunction { Value.Double(entity.location.y) },
            "z" to Value.NativeFunction { Value.Double(entity.location.z) },

            // Methods
            "remove" to Value.NativeFunction {
                entity.remove()
                Value.Null
            },
            "teleport" to Value.NativeFunction { args ->
                val x = toDouble(args.getOrNull(1)) ?: error("teleport requires x")
                val y = toDouble(args.getOrNull(2)) ?: error("teleport requires y")
                val z = toDouble(args.getOrNull(3)) ?: error("teleport requires z")
                entity.teleport(Location(entity.world, x, y, z))
                Value.Null
            },
            "kill" to Value.NativeFunction {
                if (entity is LivingEntity) {
                    entity.health = 0.0
                } else {
                    entity.remove()
                }
                Value.Null
            }
        )

        // LivingEntity extensions (health, position setters)
        if (entity is LivingEntity) {
            methods["health"] = Value.NativeFunction { Value.Double(entity.health) }
            methods["max_health"] = Value.NativeFunction {
                Value.Double(entity.getAttribute(Attribute.MAX_HEALTH)?.value ?: 20.0)
            }
            methods["set_health"] = Value.NativeFunction { args ->
                val h = toDouble(args.getOrNull(1)) ?: error("set_health requires a number")
                val max = entity.getAttribute(Attribute.MAX_HEALTH)?.value ?: 20.0
                entity.health = h.coerceIn(0.0, max)
                Value.Null
            }
        }

        return Value.Instance(ClassDescriptor(name = "Entity", superClass = null, methods = methods))
    }

    private fun toDouble(v: Value?): Double? = when (v) {
        is Value.Double -> v.value
        is Value.Float -> v.value.toDouble()
        is Value.Int -> v.value.toDouble()
        else -> null
    }
}
```

Note: Position setters (`entity.x = ...`) are deferred to the SET_PROPERTY VM change (see spec "Property setter approach"). For v1, entity position is set via `entity.teleport(x, y, z)` or `entity.set_health(n)`.

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/InkEntityClass.kt
git commit -m "feat(ink.paper): add InkEntityClass wrapper for entity manipulation"
```

---

### Task 3: Create WorldClass.kt

**Files:**
- Create: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/WorldClass.kt`

- [ ] **Step 1: Create WorldClass.kt**

Follows the pattern from `/c/Users/justi/dev/ink/ink-bukkit/src/main/kotlin/org/inklang/bukkit/runtime/WorldClass.kt` but significantly expanded with the spec's full API. Uses method-based approach for v1 (read properties via NativeFunction, write via `set_*` methods). The `set_time`, `set_weather`, etc. methods serve as the write path.

```kotlin
package org.inklang.paper

import org.bukkit.Difficulty
import org.bukkit.Material
import org.bukkit.World
import org.bukkit.entity.EntityType
import org.bukkit.Location
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object WorldClass {
    fun wrap(world: World): Value.Instance {
        return Value.Instance(
            ClassDescriptor(
                name = "World",
                superClass = null,
                readOnly = true,
                methods = mapOf(
                    // Read-only properties
                    "name" to Value.NativeFunction { Value.String(world.name) },
                    "seed" to Value.NativeFunction { Value.Int(world.seed.toInt()) },
                    "environment" to Value.NativeFunction {
                        Value.String(world.environment.name.lowercase())
                    },

                    // Readable + settable via methods
                    "time" to Value.NativeFunction { Value.Int(world.time.toInt()) },
                    "weather" to Value.NativeFunction {
                        val w = when {
                            world.isThundering -> "thunder"
                            world.hasStorm() -> "rain"
                            else -> "clear"
                        }
                        Value.String(w)
                    },
                    "difficulty" to Value.NativeFunction {
                        Value.String(world.difficulty.name.lowercase())
                    },
                    "pvp" to Value.NativeFunction { Value.Boolean(world.pvp) },

                    // Write methods
                    "set_time" to Value.NativeFunction { args ->
                        val time = toInt(args.getOrNull(1)) ?: error("set_time requires an int")
                        world.time = time.toLong()
                        Value.Null
                    },
                    "set_weather" to Value.NativeFunction { args ->
                        val weather = toString(args.getOrNull(1)) ?: error("set_weather requires a string")
                        when (weather.lowercase()) {
                            "clear" -> { world.setStorm(false); world.isThundering = false }
                            "rain" -> { world.setStorm(true); world.isThundering = false }
                            "thunder" -> { world.setStorm(true); world.isThundering = true }
                            else -> error("Unknown weather: $weather. Use clear, rain, or thunder.")
                        }
                        Value.Null
                    },
                    "set_difficulty" to Value.NativeFunction { args ->
                        val diff = toString(args.getOrNull(1)) ?: error("set_difficulty requires a string")
                        world.difficulty = try {
                            Difficulty.valueOf(diff.uppercase())
                        } catch (_: IllegalArgumentException) {
                            error("Unknown difficulty: $diff. Use peaceful, easy, normal, or hard.")
                        }
                        Value.Null
                    },
                    "set_pvp" to Value.NativeFunction { args ->
                        val pvp = args.getOrNull(1)?.let {
                            if (it is Value.Boolean) it.value else true
                        } ?: true
                        world.pvp = pvp
                        Value.Null
                    },

                    // Block operations
                    "getBlock" to Value.NativeFunction { args ->
                        val x = toInt(args.getOrNull(1)) ?: error("getBlock requires x")
                        val y = toInt(args.getOrNull(2)) ?: error("getBlock requires y")
                        val z = toInt(args.getOrNull(3)) ?: error("getBlock requires z")
                        BlockClass.wrap(world.getBlockAt(x, y, z))
                    },
                    "setBlock" to Value.NativeFunction { args ->
                        val x = toInt(args.getOrNull(1)) ?: error("setBlock requires x")
                        val y = toInt(args.getOrNull(2)) ?: error("setBlock requires y")
                        val z = toInt(args.getOrNull(3)) ?: error("setBlock requires z")
                        val materialName = toString(args.getOrNull(4)) ?: error("setBlock requires material name")
                        val mat = resolveMaterial(materialName)
                        world.getBlockAt(x, y, z).type = mat
                        Value.Null
                    },

                    // Biome operations
                    "getBiome" to Value.NativeFunction { args ->
                        val x = toInt(args.getOrNull(1)) ?: error("getBiome requires x")
                        val y = toInt(args.getOrNull(2)) ?: error("getBiome requires y")
                        val z = toInt(args.getOrNull(3)) ?: error("getBiome requires z")
                        val biome = world.getBiome(x, y, z)
                        Value.String(biome.name.lowercase().replace("_", " "))
                    },
                    "setBiome" to Value.NativeFunction { args ->
                        val x = toInt(args.getOrNull(1)) ?: error("setBiome requires x")
                        val y = toInt(args.getOrNull(2)) ?: error("setBiome requires y")
                        val z = toInt(args.getOrNull(3)) ?: error("setBiome requires z")
                        val biomeName = toString(args.getOrNull(4)) ?: error("setBiome requires biome name")
                        val biome = org.bukkit.block.Biome.entries.find {
                            it.name.equals(biomeName.replace(" ", "_"), ignoreCase = true)
                        } ?: error("Unknown biome: $biomeName")
                        world.setBiome(x, y, z, biome)
                        Value.Null
                    },

                    // Height query
                    "getHeight" to Value.NativeFunction { args ->
                        val x = toInt(args.getOrNull(1)) ?: error("getHeight requires x")
                        val z = toInt(args.getOrNull(2)) ?: error("getHeight requires z")
                        Value.Int(world.getHighestBlockYAt(x, z))
                    },

                    // Entity spawn
                    "spawnEntity" to Value.NativeFunction { args ->
                        val typeName = toString(args.getOrNull(1)) ?: error("spawnEntity requires entity type")
                        val x = toDouble(args.getOrNull(2)) ?: error("spawnEntity requires x")
                        val y = toDouble(args.getOrNull(3)) ?: error("spawnEntity requires y")
                        val z = toDouble(args.getOrNull(4)) ?: error("spawnEntity requires z")
                        val entityType = try {
                            EntityType.valueOf(typeName.uppercase())
                        } catch (_: IllegalArgumentException) {
                            error("Unknown entity type: $typeName")
                        }
                        val location = Location(world, x, y, z)
                        val entity = world.spawnEntity(location, entityType)
                        InkEntityClass.wrap(entity)
                    }
                )
            )
        )
    }

    private fun resolveMaterial(name: String): Material {
        val key = name.lowercase().removePrefix("minecraft:")
        return Material.matchMaterial(key)
            ?: error("Unknown material: $name")
    }

    private fun toInt(v: Value?): Int? = when (v) {
        is Value.Int -> v.value
        is Value.Double -> v.value.toInt()
        else -> null
    }

    private fun toDouble(v: Value?): Double? = when (v) {
        is Value.Double -> v.value
        is Value.Float -> v.value.toDouble()
        is Value.Int -> v.value.toDouble()
        else -> null
    }

    private fun toString(v: Value?): String? = when (v) {
        is Value.String -> v.value
        is Value.Int -> v.value.toString()
        else -> null
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/WorldClass.kt
git commit -m "feat(ink.paper): add WorldClass wrapper with full world manipulation API"
```

---

## Chunk 2: Executor Integration

### Task 4: Add `world` injection to MobExecutor

**Files:**
- Modify: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/MobExecutor.kt`
  - Line 19: Add `private val host: HostAPI` is already there
  - Lines 99-130 (MobListener): Add `world` to each `fire()` call's globals map
  - Also replace `Value.JavaObject(event.entity)` with `InkEntityClass.wrap(event.entity)` for the `entity` global

- [ ] **Step 1: Add world import**

Add `import org.inklang.paper.WorldClass` to the imports (it's in the same package, so no import needed — just use `WorldClass.wrap(...)`).

- [ ] **Step 2: Add world to MobListener's fire() calls**

In `MobListener`, each `fire()` call passes a globals map. Add `"world" to WorldClass.wrap(event.entity.world)` to every event handler method. Also replace `Value.JavaObject(event.entity)` with `InkEntityClass.wrap(event.entity)`.

Replace the five `@EventHandler` methods in `MobListener` (lines ~99-125):

```kotlin
@EventHandler
fun onSpawn(event: EntitySpawnEvent) {
    if (event.entity.type != entityType) return
    fire("on_spawn", mapOf(
        "entity" to InkEntityClass.wrap(event.entity),
        "world" to WorldClass.wrap(event.entity.world)
    ))
}

@EventHandler
fun onDeath(event: EntityDeathEvent) {
    if (event.entity.type != entityType) return
    fire("on_death", mapOf(
        "entity" to InkEntityClass.wrap(event.entity),
        "world" to WorldClass.wrap(event.entity.world)
    ))
}

@EventHandler
fun onDamage(event: EntityDamageEvent) {
    if (event.entity.type != entityType) return
    fire("on_damage", mapOf(
        "entity" to InkEntityClass.wrap(event.entity),
        "damage" to Value.Double(event.damage),
        "cancel" to Value.NativeFunction { event.isCancelled = true; Value.Null },
        "world" to WorldClass.wrap(event.entity.world)
    ))
}

@EventHandler
fun onTarget(event: EntityTargetEvent) {
    if (event.entity.type != entityType) return
    fire("on_target", mapOf(
        "entity" to InkEntityClass.wrap(event.entity),
        "target" to (event.target?.let { InkEntityClass.wrap(it) } ?: Value.Null),
        "world" to WorldClass.wrap(event.entity.world)
    ))
}

@EventHandler
fun onInteract(event: PlayerInteractEntityEvent) {
    if (event.rightClicked.type != entityType) return
    fire("on_interact", mapOf(
        "entity" to InkEntityClass.wrap(event.rightClicked),
        "player" to Value.JavaObject(event.player),
        "world" to WorldClass.wrap(event.rightClicked.world)
    ))
}
```

Note: `player` in `onInteract` stays as `Value.JavaObject` for now since PlayerClass is not part of this spec's scope. It can be upgraded later.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/MobExecutor.kt
git commit -m "feat(ink.paper): inject world global and wrapped entities into mob handlers"
```

---

### Task 5: Add `world` injection to PlayerExecutor

**Files:**
- Modify: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PlayerExecutor.kt`
  - Lines 79-100 (PlayerListener): Add `world` to each `fire()` call's globals

- [ ] **Step 1: Add world to PlayerListener's fire() calls**

Replace the three `@EventHandler` methods in `PlayerListener` (lines ~82-97):

```kotlin
@EventHandler
fun onJoin(event: PlayerJoinEvent) {
    fire("on_join", mapOf(
        "player" to Value.JavaObject(event.player),
        "world" to WorldClass.wrap(event.player.world)
    ))
}

@EventHandler
fun onQuit(event: PlayerQuitEvent) {
    fire("on_leave", mapOf(
        "player" to Value.JavaObject(event.player),
        "world" to WorldClass.wrap(event.player.world)
    ))
}

@EventHandler
fun onChat(event: AsyncPlayerChatEvent) {
    fire("on_chat", mapOf(
        "player"  to Value.JavaObject(event.player),
        "message" to Value.String(event.message),
        "cancel"  to Value.NativeFunction { event.isCancelled = true; Value.Null },
        "world" to WorldClass.wrap(event.player.world)
    ))
}
```

Note: `onChat` uses `AsyncPlayerChatEvent` which fires on an async thread. The `world` global's property reads (name, seed, etc.) should be safe on async threads, but mutation methods (`setBlock`, `spawnEntity`, etc.) require the main thread. Scripts that call world mutation methods from `on_chat` will throw — this is acceptable for v1. The spec notes this under "Thread safety".

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/PlayerExecutor.kt
git commit -m "feat(ink.paper): inject world global into player handlers"
```

---

### Task 6: Add `world` injection to CommandExecutor

**Files:**
- Modify: `tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/CommandExecutor.kt`
  - Lines 39-49 (the `vm.setGlobals` call): Add `world` to globals

- [ ] **Step 1: Add world to CommandExecutor's globals**

Replace the `vm.setGlobals` call in the `activate()` method (line ~44):

```kotlin
vm.setGlobals(mapOf(
    "sender" to Value.JavaObject(sender),
    "args"   to Builtins.newArray(args.map { Value.String(it) }.toMutableList()),
    "world" to if (sender is org.bukkit.entity.Player) {
        WorldClass.wrap(sender.world)
    } else {
        Value.Null
    }
))
```

Commands can be executed by non-player senders (console, command blocks). Only inject `world` when the sender is a Player.

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/ink.paper/runtime/paper/src/main/kotlin/org/inklang/paper/CommandExecutor.kt
git commit -m "feat(ink.paper): inject world global into command handlers"
```

---

## Chunk 3: Build Verification

### Task 7: Verify the runtime compiles

**Files:** None (verification only)

- [ ] **Step 1: Build the paper runtime**

```bash
cd tests/fixtures/ink.paper/runtime/paper && ./gradlew build
```

Expected: `BUILD SUCCESSFUL`

If compilation fails, fix the issues. Common problems:
- Missing imports (WorldClass, BlockClass, InkEntityClass are in the same package, no import needed)
- API differences between the ink repo's Bukkit runtime and this standalone runtime
- Paper API method signature differences

- [ ] **Step 2: Commit any fixes**

```bash
git add -u && git commit -m "fix(ink.paper): resolve compilation issues in world manipulation wrappers"
```

---

## Summary

| Task | Component | Files |
|------|-----------|-------|
| 1 | BlockClass | Create `BlockClass.kt` |
| 2 | InkEntityClass | Create `InkEntityClass.kt` |
| 3 | WorldClass | Create `WorldClass.kt` |
| 4 | MobExecutor | Add `world` + entity wrapping |
| 5 | PlayerExecutor | Add `world` |
| 6 | CommandExecutor | Add `world` |
| 7 | Build | Verify compilation |

Total: 3 new files, 3 modified files, 1 build verification.
