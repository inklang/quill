package org.inklang.paper

import org.bukkit.Bukkit
import org.bukkit.scoreboard.Team
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class TeamExecutor(
    private val teamName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI,
    private val bridge: PaperBridge
) : BlockExecutor {
    private var bukkitTeam: Team? = null
    private val handlers = mutableMapOf<String, Int>()

    override fun activate() {
        val sb = Bukkit.getScoreboardManager()?.mainScoreboard ?: return
        val team = sb.getTeam(teamName) ?: sb.registerNewTeam(teamName)
        bukkitTeam = team

        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            when (node.ruleName.substringAfterLast('/')) {
                "prefix_clause" -> node.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value?.let { team.prefix = it }
                "suffix_clause" -> node.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value?.let { team.suffix = it }
                "friendly_fire_clause" -> {
                    node.children.filterIsInstance<CstNode.KeywordNode>().firstOrNull()?.value?.let { team.setAllowFriendlyFire(it == "true") }
                }
                "on_join_clause" -> node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull()?.let { handlers["on_join"] = it.funcIdx }
                "on_leave_clause" -> node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull()?.let { handlers["on_leave"] = it.funcIdx }
            }
        }

        bridge.teamRegistry[teamName] = this
        host.getLogger().info("[ink.paper/team] Registered '$teamName' (handlers: ${handlers.keys.joinToString()})")
    }

    fun triggerHandler(eventName: String, playerGlobal: Value) {
        val funcIdx = handlers[eventName] ?: return
        if (funcIdx >= chunk.functions.size) return
        try {
            vm.executeWithLock {
                vm.setGlobals(mapOf("player" to playerGlobal))
                vm.execute(chunk.functions[funcIdx])
            }
        } catch (e: Exception) {
            host.getLogger().warning("[ink.paper] Error in team '$teamName' $eventName: ${e.message}")
        }
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}
    override fun deactivate() {
        bukkitTeam?.unregister()
        bukkitTeam = null
        bridge.teamRegistry.remove(teamName)
    }
}
