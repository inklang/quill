package org.inklang.paper

import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Chunk
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI
import org.inklang.packages.PackageBridge

class PaperBridge : PackageBridge {

    override val name = "ink.paper"
    override val blockTypes = listOf("mob", "player", "command")

    private lateinit var host: HostAPI

    override fun onEnable(host: HostAPI) {
        this.host = host
        host.getLogger().info("[ink.paper] enabled")
    }

    override fun onDisable() {
        host.getLogger().info("[ink.paper] disabled")
    }

    override fun createExecutor(
        blockType: String,
        blockName: String,
        vm: ContextVM,
        chunk: Chunk,
        declaration: CstNode.Declaration
    ): BlockExecutor = when (blockType) {
        "mob"     -> MobExecutor(blockName, vm, chunk, declaration, host)
        "player"  -> PlayerExecutor(blockName, vm, chunk, declaration, host)
        "command" -> CommandExecutor(blockName, vm, chunk, declaration, host)
        else      -> throw IllegalArgumentException("[ink.paper] Unknown block type: $blockType")
    }
}
