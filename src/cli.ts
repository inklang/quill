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
import { RunCommand } from './commands/run.js'
import { LoginCommand, LogoutCommand } from './commands/login.js'
import { UpdateCommand } from './commands/update.js'
import { SearchCommand } from './commands/search.js'
import { InfoCommand } from './commands/info.js'
import { DoctorCommand } from './commands/doctor.js'
import { CacheCommand, CacheCleanCommand } from './cache/commands.js'
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
  .version('0.3.2');

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
  .option('-F, --full', 'Force full recompilation of all scripts')
  .action(async (opts) => {
    requireProject()
    const cmd = new InkBuildCommand(process.cwd())
    await cmd.run({ full: !!opts.full })
  })

// cache-info as standalone command (alias: cache)
const cacheInfoCmd = program
  .command('cache-info')
  .description('Show build cache info')
  .alias('cache')
  .action(async () => {
    requireProject()
    new CacheCommand(projectDir).run()
  })

// cache clean as subcommand of cache-info
cacheInfoCmd
  .command('clean')
  .description('Remove build cache')
  .action(async () => {
    requireProject()
    new CacheCleanCommand(projectDir).run()
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
  .command('search <query>')
  .description('Search the registry for packages')
  .option('--page <n>', 'Page number', '1')
  .option('--json', 'Output raw JSON')
  .action(async (query, opts) => {
    const page = parseInt(opts.page || '1', 10)
    await new SearchCommand().run(query, page, !!opts.json)
  })

program
  .command('info <pkg>')
  .description('Show details about a package')
  .option('--version <ver>', 'Show specific version')
  .option('--json', 'Output raw JSON')
  .action(async (pkg, opts) => {
    await new InfoCommand().run(pkg, opts.version, !!opts.json)
  })

program
  .command('watch')
  .description('Watch for file changes and rebuild')
  .action(async () => {
    requireProject()
    const cmd = new WatchCommand(process.cwd())
    await cmd.run()
  })

program
  .command('run')
  .description('Build, deploy, and run a managed Paper dev server')
  .option('--no-watch', 'build + deploy + start server without file watching')
  .action(async (opts) => {
    requireProject()
    const cmd = new RunCommand(process.cwd())
    await cmd.run({ noWatch: !opts.watch })
  })

program
  .command('doctor')
  .description('Run diagnostics and check for common issues')
  .option('--json', 'Output JSON')
  .action(async (opts) => {
    await new DoctorCommand().run(!!opts.json)
  })

const COMMAND_GROUPS = [
  { title: 'Project',      names: ['new', 'init'] },
  { title: 'Dependencies', names: ['add', 'remove', 'install', 'update', 'ls', 'clean'] },
  { title: 'Build',        names: ['build', 'check', 'watch', 'run'] },
  { title: 'Cache',        names: ['cache'] },
  { title: 'Registry',     names: ['login', 'logout', 'publish', 'search', 'info'] },
  { title: 'Doctor',       names: ['doctor'] },
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

// Handle errors from async actions - ensures errors are caught and printed properly
program.exitOverride((err) => {
  if (err.message) {
    console.error(err.message)
  }
  process.exit(err.exitCode ?? 1)
})

program.on('command:*', () => {
  console.error('Unknown command. Run "quill --help" for available commands.')
  process.exit(1)
})

// Catch unhandled promise rejections from async command handlers
process.on('unhandledRejection', (reason: any) => {
  if (reason?.message) {
    console.error(reason.message)
  } else if (reason) {
    console.error(reason)
  }
  process.exit(1)
})

program.parse()
