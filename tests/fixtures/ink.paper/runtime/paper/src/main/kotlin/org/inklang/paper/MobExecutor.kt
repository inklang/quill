package org.inklang.paper

import org.bukkit.entity.EntityType
import org.bukkit.event.EventHandler
import org.bukkit.event.HandlerList
import org.bukkit.event.Listener
import org.bukkit.event.entity.EntityDamageEvent
import org.bukkit.event.entity.EntityDeathEvent
import org.bukkit.event.entity.EntitySpawnEvent
import org.bukkit.event.entity.EntityTargetEvent
import org.bukkit.event.player.PlayerInteractEntityEvent
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class MobExecutor(
    private val entityTypeName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {

    private val handlers: Map<String, Int> by lazy { extractHandlers(declaration) }
    private var listener: MobListener? = null

    override fun activate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin
        val entityType = runCatching { EntityType.valueOf(entityTypeName.uppercase()) }.getOrElse {
            host.getLogger().warning("[ink.paper/mob] Unknown entity type '$entityTypeName' — skipping")
            return
        }
        if (handlers.isEmpty()) return
        val l = MobListener(entityType, entityTypeName, handlers, chunk, vm)
        plugin.server.pluginManager.registerEvents(l, plugin)
        listener = l
        host.getLogger().info("[ink.paper/mob] Registered $entityTypeName (${handlers.keys.joinToString()})")
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
                "on_spawn_clause"    -> "on_spawn"
                "on_death_clause"    -> "on_death"
                "on_damage_clause"   -> "on_damage"
                "on_target_clause"   -> "on_target"
                "on_interact_clause" -> "on_interact"
                else                 -> continue  // on_tick_clause: no Paper event, skip
            }
            val fnBlock = node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull() ?: continue
            result[eventName] = fnBlock.funcIdx
        }
        return result
    }
}

class MobListener(
    private val entityType: EntityType,
    private val mobName: String,
    private val handlers: Map<String, Int>,
    private val chunk: Chunk,
    private val vm: ContextVM
) : Listener {

    @EventHandler
    fun onSpawn(event: EntitySpawnEvent) {
        if (event.entity.type != entityType) return
        fire("on_spawn", mapOf("entity" to Value.JavaObject(event.entity)))
    }

    @EventHandler
    fun onDeath(event: EntityDeathEvent) {
        if (event.entity.type != entityType) return
        fire("on_death", mapOf("entity" to Value.JavaObject(event.entity)))
    }

    @EventHandler
    fun onDamage(event: EntityDamageEvent) {
        if (event.entity.type != entityType) return
        fire("on_damage", mapOf(
            "entity" to Value.JavaObject(event.entity),
            "damage" to Value.Double(event.damage),
            "cancel" to Value.NativeFunction { event.isCancelled = true; Value.Null }
        ))
    }

    @EventHandler
    fun onTarget(event: EntityTargetEvent) {
        if (event.entity.type != entityType) return
        fire("on_target", mapOf(
            "entity" to Value.JavaObject(event.entity),
            "target" to (event.target?.let { Value.JavaObject(it) } ?: Value.Null)
        ))
    }

    @EventHandler
    fun onInteract(event: PlayerInteractEntityEvent) {
        if (event.rightClicked.type != entityType) return
        fire("on_interact", mapOf(
            "entity" to Value.JavaObject(event.rightClicked),
            "player" to Value.JavaObject(event.player)
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
            System.err.println("[ink.paper] Error in mob '$mobName' $eventName: ${e.message}")
        }
    }
}
