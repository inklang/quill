package org.inklang.paper

import org.bukkit.command.Command
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player
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

        // Find the handler function (on_execute_clause or legacy command_clause)
        val fnBlock = findHandlerBlock() ?: run {
            host.getLogger().warning("[ink.paper/command] No function block in '/$commandName'")
            return
        }
        val funcIdx = fnBlock.funcIdx

        // Extract permission
        val permission = declaration.body
            .filterIsInstance<CstNode.RuleMatch>()
            .find { it.ruleName.substringAfterLast('/') == "permission_clause" }
            ?.children?.filterIsInstance<CstNode.StringLiteral>()?.firstOrNull()?.value

        // Extract aliases
        val aliases = declaration.body
            .filterIsInstance<CstNode.RuleMatch>()
            .filter { it.ruleName.substringAfterLast('/') == "alias_clause" }
            .mapNotNull { it.children.filterIsInstance<CstNode.StringLiteral>().firstOrNull()?.value }

        // Register command
        val cmd = object : Command(commandName) {
            override fun execute(sender: CommandSender, label: String, args: Array<out String>): Boolean {
                try {
                    vm.executeWithLock {
                        vm.setGlobals(mapOf(
                            "sender" to Value.JavaObject(sender),
                            "args"   to Builtins.newArray(args.map { Value.String(it) }.toMutableList()),
                            "world" to if (sender is Player) {
                                WorldClass.wrap(sender.world)
                            } else {
                                Value.Null
                            }
                        ))
                        vm.execute(chunk.functions[funcIdx])
                    }
                } catch (e: Exception) {
                    System.err.println("[ink.paper] Error in command '/$commandName': ${e.message}")
                }
                return true
            }
        }

        permission?.let { cmd.setPermission(it) }
        if (aliases.isNotEmpty()) cmd.setAliases(aliases)

        plugin.server.commandMap.register(plugin.description.name.lowercase(), cmd)
        host.getLogger().info("[ink.paper/command] Registered /$commandName" +
            (if (permission != null) " (perm: $permission)" else "") +
            (if (aliases.isNotEmpty()) " (aliases: ${aliases.joinToString()})" else ""))
    }

    override fun handleEvent(eventName: String, globals: Map<String, Value>) {}

    // Bukkit commandMap has no clean unregister API
    override fun deactivate() {}

    private fun findHandlerBlock(): CstNode.FunctionBlock? {
        // Try on_execute_clause first, then fall back to command_clause
        for (node in declaration.body) {
            if (node !is CstNode.RuleMatch) continue
            val clause = node.ruleName.substringAfterLast('/')
            if (clause == "on_execute_clause" || clause == "command_clause") {
                return node.children.filterIsInstance<CstNode.FunctionBlock>().firstOrNull()
            }
        }
        // Legacy: bare FunctionBlock directly in body
        return declaration.body.filterIsInstance<CstNode.FunctionBlock>().firstOrNull()
    }
}
