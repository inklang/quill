package org.inklang.paper

import org.bukkit.event.EventHandler
import org.bukkit.event.HandlerList
import org.bukkit.event.Listener
import org.bukkit.event.player.AsyncPlayerChatEvent
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerQuitEvent
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class PlayerExecutor(
    private val declName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {

    private val handlers: Map<String, Int> by lazy { extractHandlers(declaration) }
    private var listener: PlayerListener? = null

    override fun activate() {
        if (handlers.isEmpty()) return
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
        val l = PlayerListener(declName, handlers, chunk, vm)
        plugin.server.pluginManager.registerEvents(l, plugin)
        listener = l
        host.getLogger().info("[ink.paper/player] Registered $declName (${handlers.keys.joinToString()})")
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}

    override fun deactivate() {
        listener?.let { HandlerList.unregisterAll(it) }
        listener = null
    }

    private fun extractHandlers(cst: CstNode.Declaration): Map<String, Int> {
        val result = mutableMapOf<String, Int>()
        for (node in cst.body) {
            if (node !is CstNode.RuleMatch) continue
            val clause = node.ruleName.substringAfterLast('/')
            val eventName = when (clause) {
                "on_join_clause"  -> "on_join"
                "on_leave_clause" -> "on_leave"
                "on_chat_clause"  -> "on_chat"
                else              -> continue
            }
            val fnBlock = node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull() ?: continue
            result[eventName] = fnBlock.funcIdx
        }
        return result
    }
}

class PlayerListener(
    private val declName: String,
    private val handlers: Map<String, Int>,
    private val chunk: Chunk,
    private val vm: ContextVM
) : Listener {

    @EventHandler
    fun onJoin(event: PlayerJoinEvent) {
        fire("on_join", mapOf(
            "player" to Value.JavaObject(event.player),
            "world" to WorldClass.wrap(event.player.world)
        ))
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        fire("on_leave", mapOf(
            "player" to Value.JavaObject(event.player),
            "world" to WorldClass.wrap(event.player.world)
        ))
    }

    @EventHandler
    fun onChat(event: AsyncPlayerChatEvent) {
        fire("on_chat", mapOf(
            "player"  to Value.JavaObject(event.player),
            "message" to Value.String(event.message),
            "cancel"  to Value.NativeFunction { event.isCancelled = true; Value.Null },
            "world" to WorldClass.wrap(event.player.world)
        ))
    }

    private fun fire(eventName: String, globals: Map<String, Value>) {
        val funcIdx = handlers[eventName] ?: return
        if (funcIdx >= chunk.functions.size) return
        try {
            vm.executeWithLock {
                vm.setGlobals(globals)
                vm.execute(chunk.functions[funcIdx])
            }
        } catch (e: Exception) {
            System.err.println("[ink.paper] Error in player '$declName' $eventName: ${e.message}")
        }
    }
}
