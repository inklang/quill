package org.inklang.paper

import org.bukkit.scheduler.BukkitRunnable
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class RegionExecutor(
    private val regionName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {
    private var taskId: Int? = null
    private val playersInside = mutableSetOf<String>()
    private val handlers = mutableMapOf<String, Int>()
    private var worldName: String? = null
    private var minX = 0; private var minY = 0; private var minZ = 0
    private var maxX = 0; private var maxY = 0; private var maxZ = 0

    override fun activate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
        val server = host.getServer() as org.bukkit.Server

        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            when (node.ruleName.substringAfterLast('/')) {
                "world_clause" -> worldName = node.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value
                "min_clause" -> {
                    val v = node.children.filterIsInstance<CstNode.IntLiteral>().mapNotNull { it.value.toIntOrNull() }
                    if (v.size >= 3) { minX = v[0]; minY = v[1]; minZ = v[2] }
                }
                "max_clause" -> {
                    val v = node.children.filterIsInstance<CstNode.IntLiteral>().mapNotNull { it.value.toIntOrNull() }
                    if (v.size >= 3) { maxX = v[0]; maxY = v[1]; maxZ = v[2] }
                }
                "on_enter_clause" -> node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull()?.let { handlers["on_enter"] = it.funcIdx }
                "on_leave_clause" -> node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull()?.let { handlers["on_leave"] = it.funcIdx }
            }
        }

        val id = object : BukkitRunnable() {
            override fun run() {
                val current = mutableSetOf<String>()
                for (p in server.onlinePlayers) {
                    if (worldName != null && p.world.name != worldName) continue
                    val l = p.location
                    if (l.x >= minX && l.x <= maxX && l.y >= minY && l.y <= maxY && l.z >= minZ && l.z <= maxZ)
                        current.add(p.name)
                }
                for (name in current - playersInside) {
                    server.getPlayer(name)?.let { fire("on_enter", mapOf("player" to Value.JavaObject(it))) }
                }
                for (name in playersInside - current) {
                    server.getPlayer(name)?.let { fire("on_leave", mapOf("player" to Value.JavaObject(it))) }
                }
                playersInside.clear(); playersInside.addAll(current)
            }
        }.runTaskTimer(plugin, 0L, 20L)
        taskId = id.taskId
        host.getLogger().info("[ink.paper/region] Registered '$regionName' ($minX,$minY,$minZ -> $maxX,$maxY,$maxZ)")
    }

    private fun fire(eventName: String, globals: Map<String, Value>) {
        val funcIdx = handlers[eventName] ?: return
        if (funcIdx >= chunk.functions.size) return
        try {
            vm.executeWithLock { vm.setGlobals(globals); vm.execute(chunk.functions[funcIdx]) }
        } catch (e: Exception) {
            host.getLogger().warning("[ink.paper] Error in region '$regionName' $eventName: ${e.message}")
        }
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}
    override fun deactivate() {
        taskId?.let { (host.getPlugin() as org.bukkit.plugin.Plugin).server.scheduler.cancelTask(it) }
        playersInside.clear()
    }
}
