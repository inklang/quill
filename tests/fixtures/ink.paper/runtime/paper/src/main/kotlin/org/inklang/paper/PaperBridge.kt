package org.inklang.paper

import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI
import org.inklang.packages.PackageBridge

class PaperBridge : PackageBridge {

    override val name = "ink.paper"
    override val blockTypes = listOf("mob", "player", "command", "task", "config", "scoreboard", "team", "region")

    private lateinit var host: HostAPI

    // Cross-executor registry for team on_join/on_leave callbacks
    val teamRegistry = mutableMapOf<String, TeamExecutor>()

    override fun onEnable(host: HostAPI) {
        this.host = host
        host.getLogger().info("[ink.paper] enabled")
    }

    override fun onDisable() {
        teamRegistry.clear()
        host.getLogger().info("[ink.paper] disabled")
    }

    override fun createExecutor(
        blockType: String,
        blockName: String,
        vm: ContextVM,
        chunk: Chunk,
        declaration: CstNode.Declaration
    ): BlockExecutor = when (blockType) {
        "mob"        -> MobExecutor(blockName, vm, chunk, declaration, host)
        "player"     -> PlayerExecutor(blockName, vm, chunk, declaration, host)
        "command"    -> CommandExecutor(blockName, vm, chunk, declaration, host)
        "task"       -> TaskExecutor(blockName, vm, chunk, declaration, host)
        "config"     -> ConfigExecutor(blockName, vm, chunk, declaration, host)
        "scoreboard" -> ScoreboardExecutor(blockName, vm, chunk, declaration, host)
        "team"       -> TeamExecutor(blockName, vm, chunk, declaration, host, this)
        "region"     -> RegionExecutor(blockName, vm, chunk, declaration, host)
        else         -> throw IllegalArgumentException("[ink.paper] Unknown block type: $blockType")
    }
}
