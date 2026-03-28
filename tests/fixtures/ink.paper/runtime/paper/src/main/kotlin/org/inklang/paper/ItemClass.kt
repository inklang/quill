package org.inklang.paper

import org.bukkit.inventory.ItemStack
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value

object ItemClass {
    fun wrap(stack: ItemStack): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "Item",
            superClass = null,
            readOnly = false,
            methods = mapOf(
                "type" to Value.NativeFunction { Value.String(stack.type.name) },
                "count" to Value.NativeFunction { Value.Int(stack.amount) },
                "set_count" to Value.NativeFunction { args ->
                    val c = (args.getOrNull(0) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    stack.amount = c
                    Value.Null
                },
                "name" to Value.NativeFunction {
                    val name = stack.itemMeta?.displayName()?.toString() ?: stack.type.name
                    Value.String(name)
                },
                "set_name" to Value.NativeFunction { args ->
                    val n = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val meta = stack.itemMeta ?: return@NativeFunction Value.Null
                    meta.setDisplayName(n)
                    stack.itemMeta = meta
                    Value.Null
                },
                "isUnbreakable" to Value.NativeFunction {
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
                "raw" to Value.NativeFunction { Value.JavaObject(stack) }
            )
        )
        return Value.Instance(descriptor)
    }
}
