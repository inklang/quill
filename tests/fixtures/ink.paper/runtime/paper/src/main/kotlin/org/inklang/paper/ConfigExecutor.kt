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

        val fileName = declaration.body
            .filterIsInstance<CstNode.RuleMatch>()
            .find { it.ruleName.substringAfterLast('/') == "file_clause" }
            ?.children?.filterIsInstance<CstNode.StringLiteral>()?.firstOrNull()?.value
            ?: "$configName.yml"

        val file = File(configsDir, fileName)

        val defaults = mutableMapOf<String, Value>()
        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            if (node.ruleName.substringAfterLast('/') != "config_entry_clause") continue
            val children = node.children
            val key = children.filterIsInstance<CstNode.IdentifierNode>().firstOrNull()?.value ?: continue
            val value = parseEntryValue(children) ?: continue
            if (key in RESERVED_NAMES) {
                host.getLogger().warning("[ink.paper/config] Key '$key' in '$configName' collides with method name")
            }
            defaults[key] = value
        }

        val data = if (file.exists()) {
            val loaded = ConfigClass.loadYaml(file)
            for ((k, v) in defaults) {
                if (k !in loaded) loaded[k] = v
            }
            loaded
        } else {
            ConfigClass.saveYaml(file, defaults)
            defaults.toMutableMap()
        }

        val configInstance = ConfigClass.create(configName, data, file)
        vm.executeWithLock {
            vm.setGlobals(mapOf(configName to configInstance))
        }
        host.getLogger().info("[ink.paper/config] Registered '$configName' (${defaults.size} defaults)")
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}
    override fun deactivate() {}

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
