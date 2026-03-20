#!/usr/bin/env node
import { Command } from 'commander';
import { NewCommand } from './commands/new.js';
import { InitCommand } from './commands/init.js';
import { AddCommand } from './commands/add.js';
import { RemoveCommand } from './commands/remove.js';
import { InstallCommand } from './commands/install.js';
import { LsCommand } from './commands/ls.js';
import { CleanCommand } from './commands/clean.js';

const program = new Command();
const projectDir = process.cwd();

program
  .name('quill')
  .description('Package manager for the Ink programming language')
  .version('0.1.0');

program.command('new <name>').description('Scaffold a new package').action(async (name) => {
  await new NewCommand(projectDir).run(name);
});

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

program.command('ls').description('List installed packages').action(async () => {
  await new LsCommand(projectDir).run();
});

program.command('clean').description('Remove .quill-cache/').action(async () => {
  await new CleanCommand(projectDir).run();
});

program.parse();
