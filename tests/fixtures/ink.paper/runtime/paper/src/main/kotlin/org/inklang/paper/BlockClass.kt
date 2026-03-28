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
        val biome = block.biome.key.key.lowercase().replace("_", " ")
        val light = block.lightFromBlocks.toInt()
        val isAir = block.type.isAir
        val isLiquid = block.isLiquid
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
