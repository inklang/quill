package org.inklang.paper

import org.bukkit.Material
import org.bukkit.inventory.Inventory
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object InventoryClass {
    fun wrap(inventory: Inventory): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "Inventory",
            superClass = null,
            readOnly = true,
            methods = mapOf(
                "size" to Value.NativeFunction { Value.Int(inventory.size) },
                "getItem" to Value.NativeFunction { args ->
                    val slot = (args.getOrNull(0) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val item = inventory.getItem(slot) ?: return@NativeFunction Value.Null
                    if (item.type == Material.AIR) return@NativeFunction Value.Null
                    ItemClass.wrap(item)
                },
                "setItem" to Value.NativeFunction { args ->
                    val slot = (args.getOrNull(0) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val itemValue = args.getOrNull(1) ?: return@NativeFunction Value.Null
                    val stack = when (itemValue) {
                        is Value.JavaObject -> itemValue.obj as? org.bukkit.inventory.ItemStack
                        is Value.Instance -> {
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
        return Value.Instance(descriptor)
    }
}
