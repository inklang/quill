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
                        Value.String(biome.key.key.lowercase().replace("_", " "))
                    },
                    "setBiome" to Value.NativeFunction { args ->
                        val x = toInt(args.getOrNull(1)) ?: error("setBiome requires x")
                        val y = toInt(args.getOrNull(2)) ?: error("setBiome requires y")
                        val z = toInt(args.getOrNull(3)) ?: error("setBiome requires z")
                        val biomeName = toString(args.getOrNull(4)) ?: error("setBiome requires biome name")
                        val biome = org.bukkit.block.Biome.values().find {
                            it.name().equals(biomeName.replace(" ", "_"), ignoreCase = true)
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
                    },
                    "createExplosion" to Value.NativeFunction { args ->
                        val x = toDouble(args.getOrNull(1)) ?: error("createExplosion requires x")
                        val y = toDouble(args.getOrNull(2)) ?: error("createExplosion requires y")
                        val z = toDouble(args.getOrNull(3)) ?: error("createExplosion requires z")
                        val power = (args.getOrNull(4) as? Value.Int)?.value?.toFloat() ?: 4f
                        world.createExplosion(x, y, z, power, false, true)
                        Value.Null
                    },
                    "createItem" to Value.NativeFunction { args ->
                        val materialName = toString(args.getOrNull(1)) ?: error("createItem requires material name")
                        val count = (args.getOrNull(2) as? Value.Int)?.value ?: 1
                        val mat = resolveMaterial(materialName)
                        val stack = org.bukkit.inventory.ItemStack(mat, count)
                        ItemClass.wrap(stack)
                    },
                    "dropItem" to Value.NativeFunction { args ->
                        val x = toDouble(args.getOrNull(1)) ?: error("dropItem requires x")
                        val y = toDouble(args.getOrNull(2)) ?: error("dropItem requires y")
                        val z = toDouble(args.getOrNull(3)) ?: error("dropItem requires z")
                        val itemValue = args.getOrNull(4) ?: error("dropItem requires item")
                        val stack = when (itemValue) {
                            is Value.JavaObject -> itemValue.obj as? org.bukkit.inventory.ItemStack
                            is Value.Instance -> {
                                val rawMethod = itemValue.clazz.methods["raw"]
                                if (rawMethod is Value.NativeFunction) {
                                    (rawMethod.fn(listOf()) as? Value.JavaObject)?.obj as? org.bukkit.inventory.ItemStack
                                } else null
                            }
                            else -> null
                        } ?: error("dropItem: invalid item")
                        val dropped = world.dropItem(org.bukkit.Location(world, x, y, z), stack)
                        InkEntityClass.wrap(dropped)
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
