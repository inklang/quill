package org.inklang.paper

import org.bukkit.Bukkit
import org.bukkit.scoreboard.DisplaySlot
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class ScoreboardExecutor(
    private val boardName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {
    override fun activate() {
        val sb = Bukkit.getScoreboardManager()?.mainScoreboard ?: return

        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            if (node.ruleName.substringAfterLast('/') != "objective_clause") continue
            val objName = node.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value ?: continue
            val objBlock = node.children.filterIsInstance<CstNode.Block>().firstOrNull() ?: continue

            var criteria = "dummy"
            var displayName = objName
            var slot: DisplaySlot? = null

            for (child in objBlock.children) {
                if (child !is CstNode.RuleMatch) continue
                when (child.ruleName.substringAfterLast('/')) {
                    "criteria_clause" -> criteria = child.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value ?: criteria
                    "display_clause" -> displayName = child.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value ?: displayName
                    "slot_clause" -> {
                        val kw = child.children.filterIsInstance<CstNode.KeywordNode>().firstOrNull()?.value
                        slot = when (kw) { "sidebar" -> DisplaySlot.SIDEBAR; "player_list" -> DisplaySlot.PLAYER_LIST; "below_name" -> DisplaySlot.BELOW_NAME; else -> null }
                    }
                }
            }

            val objective = sb.getObjective(objName) ?: sb.registerNewObjective(objName, criteria, displayName)
            if (slot != null) objective.displaySlot = slot
            host.getLogger().info("[ink.paper/scoreboard] Objective '$objName'")
        }

        val descriptor = ClassDescriptor(
            name = "Scoreboard",
            superClass = null,
            readOnly = true,
            methods = mapOf(
                "get_score" to Value.NativeFunction { args ->
                    val player = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Int(0)
                    val objName = (args.getOrNull(1) as? Value.String)?.value ?: return@NativeFunction Value.Int(0)
                    val obj = sb.getObjective(objName) ?: return@NativeFunction Value.Int(0)
                    Value.Int(obj.getScore(player).score)
                },
                "set_score" to Value.NativeFunction { args ->
                    val player = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val objName = (args.getOrNull(1) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val score = (args.getOrNull(2) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    sb.getObjective(objName)?.getScore(player)?.let { it -> it.score = score }
                    Value.Null
                },
                "add_score" to Value.NativeFunction { args ->
                    val player = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val objName = (args.getOrNull(1) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val amount = (args.getOrNull(2) as? Value.Int)?.value ?: return@NativeFunction Value.Null
                    val obj = sb.getObjective(objName) ?: return@NativeFunction Value.Null
                    val s = obj.getScore(player); s.score = s.score + amount
                    Value.Null
                }
            )
        )
        vm.executeWithLock { vm.setGlobals(mapOf(boardName to Value.Instance(descriptor, mutableMapOf()))) }
        host.getLogger().info("[ink.paper/scoreboard] Registered '$boardName'")
    }
    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}
    override fun deactivate() {}
}
