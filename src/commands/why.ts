import { TomlParser } from '../util/toml.js';
import path from 'path';
import fs from 'fs';

interface DepNode {
  name: string;
  version: string;
  specifiedAs: string;
  children: DepNode[];
}

export class WhyCommand {
  constructor(private projectDir: string) {}

  async run(pkgName: string): Promise<void> {
    const inkPackageTomlPath = path.join(this.projectDir, 'ink-package.toml');
    if (!fs.existsSync(inkPackageTomlPath)) {
      console.error('No ink-package.toml found. Run `quill init` or `quill new` first.');
      process.exit(1);
    }

    const manifest = TomlParser.read(inkPackageTomlPath);
    const deps: Record<string, string> = manifest.dependencies ?? {};

    if (!(pkgName in deps)) {
      console.log(`${pkgName} is not a direct dependency of ${manifest.name}.`);
      return;
    }

    const tree = this.buildDepTree(pkgName, deps[pkgName], new Set<string>());
    this.printTree(tree, '', true);
  }

  private buildDepTree(pkgName: string, specifiedAs: string, visited: Set<string>): DepNode {
    const pkgDir = path.join(this.projectDir, 'packages', pkgName.replace('/', '-'));
    const installedManifest = path.join(pkgDir, 'ink-package.toml');

    if (!fs.existsSync(installedManifest)) {
      return { name: pkgName, version: specifiedAs, specifiedAs, children: [] };
    }

    const pkgMeta = TomlParser.read(installedManifest);
    const version = pkgMeta.version ?? specifiedAs;

    const node: DepNode = { name: pkgName, version, specifiedAs, children: [] };

    if (visited.has(pkgName)) {
      return node;
    }
    visited.add(pkgName);

    const transitive: Record<string, string> = pkgMeta.dependencies ?? {};
    for (const [dep, range] of Object.entries(transitive)) {
      node.children.push(this.buildDepTree(dep, range, visited));
    }

    return node;
  }

  private printTree(node: DepNode, indent: string, isLast: boolean): void {
    const prefix = isLast ? '└── ' : '├── ';
    const self = `${node.name}@${node.version}  (${node.specifiedAs})`;
    console.log(`${indent}${prefix}${self}`);

    const childIndent = indent + (isLast ? '    ' : '│   ');
    for (let i = 0; i < node.children.length; i++) {
      this.printTree(node.children[i], childIndent, i === node.children.length - 1);
    }
  }
}
