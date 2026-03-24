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

const program = new Command();
const projectDir = process.cwd();

program
  .name('quill')
  .description('Package manager for the Ink programming language')
  .version('0.2.0');

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
  await new AddCommand(projectDir).run(pkg);
});

program.command('remove <pkg>').description('Uninstall a package').action(async (pkg) => {
  await new RemoveCommand(projectDir).run(pkg);
});

program.command('install').description('Install all dependencies from quill.toml').action(async () => {
  await new InstallCommand(projectDir).run();
});

program
  .command('update [packages...]')
  .description('Update dependencies to latest matching version')
  .action(async (packages: string[]) => {
    await new UpdateCommand(projectDir).run(packages)
  });

program.command('ls').description('List installed packages').action(async () => {
  await new LsCommand(projectDir).run();
});

program.command('clean').description('Remove .quill-cache/').action(async () => {
  await new CleanCommand(projectDir).run();
});

program
  .command('build')
  .description('Compile grammar and/or Ink scripts')
  .action(async () => {
    const cmd = new InkBuildCommand(process.cwd())
    await cmd.run()
  })

program
  .command('check')
  .description('Check grammar and Ink script for errors')
  .action(async () => {
    const cmd = new InkCheckCommand(process.cwd())
    await cmd.run()
  })

program
  .command('publish')
  .description('Publish package to the registry')
  .action(async () => {
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
    const cmd = new WatchCommand(process.cwd())
    await cmd.run()
  })

program.parse();
