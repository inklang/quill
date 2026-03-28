package org.inklang.paper

import org.bukkit.command.Command
import org.bukkit.command.CommandSender
import org.inklang.ContextVM
import org.inklang.grammar.CstNode
import org.inklang.lang.Builtins
import org.inklang.lang.Chunk
import org.inklang.lang.Value
import org.inklang.packages.BlockExecutor
import org.inklang.packages.HostAPI

class CommandExecutor(
    private val commandName: String,
    private val vm: ContextVM,
    private val chunk: Chunk,
    private val declaration: CstNode.Declaration,
    private val host: HostAPI
) : BlockExecutor {

    override fun activate() {
        val plugin = host.getPlugin() as org.bukkit.plugin.Plugin

        val fnBlock = declaration.body.filterIsInstance<CstNode.FunctionBlock>().firstOrNull()
            ?: declaration.body
                .flatMap { if (it is CstNode.RuleMatch) it.children else listOf(it) }
                .filterIsInstance<CstNode.FunctionBlock>().firstOrNull()
            ?: run {
                host.getLogger().warning("[ink.paper/command] No function block in '$commandName'")
                return
            }

        val funcIdx = fnBlock.funcIdx

        val cmd = object : Command(commandName) {
            override fun execute(sender: CommandSender, label: String, args: Array<out String>): Boolean {
                try {
                    vm.executeWithLock {
                        vm.setGlobals(mapOf(
                            "sender" to Value.JavaObject(sender),
                            "args"   to Builtins.newArray(args.map { Value.String(it) }.toMutableList())
                        ))
                        vm.execute(chunk.functions[funcIdx])
                    }
                } catch (e: Exception) {
                    System.err.println("[ink.paper] Error in command '/$commandName': ${e.message}")
                }
                return true
            }
        }

        plugin.server.commandMap.register(plugin.description.name.lowercase(), cmd)
        host.getLogger().info("[ink.paper/command] Registered /$commandName")
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}

    // Bukkit commandMap has no clean unregister API
    override fun deactivate() {}
}
