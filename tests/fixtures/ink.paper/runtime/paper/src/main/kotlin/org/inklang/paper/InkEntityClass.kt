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
