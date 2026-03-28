package org.inklang.paper

import org.bukkit.scheduler.BukkitRunnable
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

import java.util.logging.Logger

import org.inklang.paper.WorldClass

import org.inklang.paper.InkEntityClass

import java.io.File

class TaskExecutor(
    private val taskName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {
    private val taskIds = mutableListOf<Int>()

    override fun activate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
        val server = host.getServer()

        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            val clause = node.ruleName.substringAfterLast('/')
            val fnBlock = node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull() ?: continue
            val funcIdx = fnBlock.funcIdx

            when (clause) {
                "every_clause" -> {
                    val ticks = node.children.filterIsInstance<CstNode.IntLiteral>().firstOrNull()?.value?.toIntOrNull() ?: continue
                    val world = (server as org.bukkit.Server).worlds[0]
                    val taskId = object : BukkitRunnable() {
                        override fun run() {
                            fire(funcIdx, mapOf("server" to Value.JavaObject(server), "world" to WorldClass.wrap(world)))
                        }
                    }.runTaskTimer(plugin, 0L, ticks.toLong())
                    taskIds.add(taskId.taskId)
                    host.getLogger().info("[ink.paper/task] Registered '$taskName' every $ticks ticks")
                }
                "delay_clause" -> {
                    val ticks = node.children.filterIsInstance<CstNode.IntLiteral>().firstOrNull()?.value?.toIntOrNull() ?: continue
                    val world = (server as org.bukkit.Server).worlds[0]
                    val taskId = object : BukkitRunnable() {
                        override fun run() {
                            fire(funcIdx, mapOf("server" to Value.JavaObject(server), "world" to WorldClass.wrap(world)))
                        }
                    }.runTaskLater(plugin, ticks.toLong())
                    taskIds.add(taskId.taskId)
                    host.getLogger().info("[ink.paper/task] Registered '$taskName' delay $ticks ticks")
                }
            }
        }
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}
    override fun deactivate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
        for (taskId in taskIds) {
            plugin.server.scheduler.cancelTask(taskId)
        }
        taskIds.clear()
    }

    private fun fire(funcIdx: Int, globals: Map<String, Value>) {
        if (funcIdx >= chunk.functions.size) return
        try {
            vm.executeWithLock {
                vm.setGlobals(globals)
                vm.execute(chunk.functions[funcIdx])
            }
        } catch (e: Exception) {
            host.getLogger().warning("[ink.paper] Error in task '$taskName': ${e.message}")
        }
    }
}
