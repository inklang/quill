#!/usr/bin/env node
import { Command } from 'commander';
import { NewCommand } from './commands/new.js';
import { InitCommand } from './commands/init.js';
import { AddCommand } from './commands/add.js';
import { RemoveCommand } from './commands/remove.js';
import { InstallCommand } from './commands/install.js';
import { LsCommand } from './commands/ls.js';
import { CleanCommand } from './commands/clean.js';
import { InkBuildCommand } from './commands/ink-build.js'
import { InkCheckCommand } from './commands/ink-check.js'
import { PublishCommand } from './commands/publish.js'
import { WatchCommand } from './commands/watch.js'
import { LoginCommand, LogoutCommand } from './commands/login.js'
import { UpdateCommand } from './commands/update.js'
import { existsSync } from 'fs'
import { join } from 'path'

const program = new Command();
const projectDir = process.cwd();

function requireProject(): void {
  if (!existsSync(join(projectDir, 'ink-package.toml'))) {
    console.error('Error: No ink-package.toml found in current directory.')
    console.error("Run 'quill init' to initialize a project here, or 'quill new <name>' to create a new one.")
    process.exit(1)
  }
}

program
  .name('quill')
  .description('Package manager for the Ink programming language')
  .version('0.2.2');

program
  .command('new <name>')
  .description('Scaffold a new project or grammar package')
  .option('--package', 'scaffold a publishable grammar package with runtime')
  .option('--template <name>', 'use a named template (blank, hello-world, full)')
  .action(async (name, opts) => {
    if (opts.package && opts.template) {
      console.error('Error: --template and --package are mutually exclusive')
      process.exit(1)
    }
    if (opts.template && !['blank', 'hello-world', 'full'].includes(opts.template)) {
      console.error(`Error: Unknown template "${opts.template}". Available templates: blank, hello-world, full`)
      process.exit(1)
    }
    await new NewCommand(projectDir).run(name, { isPackage: !!opts.package, template: opts.template })
  })

program.command('init').description('Initialize quill.toml in existing project').action(async () => {
  await new InitCommand(projectDir).run();
});

program.command('add <pkg>').description('Install a package').action(async (pkg) => {
  requireProject()
  await new AddCommand(projectDir).run(pkg);
});

program.command('remove <pkg>').description('Uninstall a package').action(async (pkg) => {
  requireProject()
  await new RemoveCommand(projectDir).run(pkg);
});

program.command('install').description('Install all dependencies from quill.toml').action(async () => {
  requireProject()
  await new InstallCommand(projectDir).run();
});

program
  .command('update [packages...]')
  .description('Update dependencies to latest matching version')
  .action(async (packages: string[]) => {
    requireProject()
    await new UpdateCommand(projectDir).run(packages)
  });

program.command('ls').description('List installed packages').action(async () => {
  requireProject()
  await new LsCommand(projectDir).run();
});

program.command('clean').description('Remove .quill-cache/').action(async () => {
  requireProject()
  await new CleanCommand(projectDir).run();
});

program
  .command('build')
  .description('Compile grammar and/or Ink scripts')
  .action(async () => {
    requireProject()
    const cmd = new InkBuildCommand(process.cwd())
    await cmd.run()
  })

program
  .command('check')
  .description('Check grammar and Ink script for errors')
  .action(async () => {
    requireProject()
    const cmd = new InkCheckCommand(process.cwd())
    await cmd.run()
  })

program
  .command('publish')
  .description('Publish package to the registry')
  .action(async () => {
    requireProject()
    const cmd = new PublishCommand(process.cwd())
    await cmd.run()
  })

program
  .command('login')
  .description('Generate a keypair and register with the registry')
  .action(async () => {
    await new LoginCommand().run()
  })

program
  .command('logout')
  .description('Remove saved keypair from ~/.quillrc')
  .action(() => {
    new LogoutCommand().run()
  })

program
  .command('watch')
  .description('Watch for file changes and rebuild')
  .action(async () => {
    requireProject()
    const cmd = new WatchCommand(process.cwd())
    await cmd.run()
  })

const COMMAND_GROUPS = [
  { title: 'Project',      names: ['new', 'init'] },
  { title: 'Dependencies', names: ['add', 'remove', 'install', 'update', 'ls', 'clean'] },
  { title: 'Build',        names: ['build', 'check', 'watch'] },
  { title: 'Registry',     names: ['login', 'logout', 'publish'] },
]

program.configureHelp({
  formatHelp(cmd, helper) {
    const indent = '  '
    function pad(str: string, width: number) {
      return str + ' '.repeat(Math.max(1, width - str.length))
    }

    const allCmds = helper.visibleCommands(cmd)
    const cmdMap = new Map(allCmds.map(c => [c.name(), c]))
    const termWidth = Math.max(...allCmds.map(c => helper.subcommandTerm(c).length))

    let out = ''

    // Usage + description
    out += `Usage: ${helper.commandUsage(cmd)}\n\n`
    const desc = helper.commandDescription(cmd)
    if (desc) out += `${desc}\n\n`

    // Options
    const opts = helper.visibleOptions(cmd)
    if (opts.length) {
      const optWidth = Math.max(...opts.map(o => helper.optionTerm(o).length))
      out += 'Options:\n'
      for (const opt of opts) {
        out += `${indent}${pad(helper.optionTerm(opt), optWidth + 2)}${helper.optionDescription(opt)}\n`
      }
      out += '\n'
    }

    // Grouped commands
    for (const group of COMMAND_GROUPS) {
      const cmds = group.names.map(n => cmdMap.get(n)).filter(Boolean) as Command[]
      if (!cmds.length) continue
      out += `${group.title}:\n`
      for (const c of cmds) {
        out += `${indent}${pad(helper.subcommandTerm(c), termWidth + 2)}${helper.subcommandDescription(c)}\n`
      }
      out += '\n'
    }

    return out
  }
})

program.parse();
