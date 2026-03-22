import { TomlParser } from '../util/toml.js';
import { PackageManifest } from '../model/manifest.js';
import fs from 'fs';
import path from 'path';

export class NewCommand {
  constructor(private projectDir: string) {}

  async run(name: string): Promise<void> {
    const targetDir = path.join(this.projectDir, name);
    if (fs.existsSync(targetDir)) {
      console.error(`Directory already exists: ${name}/`);
      return;
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const manifest: PackageManifest = {
      name,
      version: '0.1.0',
      main: 'mod',
      dependencies: {},
    };

    fs.writeFileSync(path.join(targetDir, 'ink-package.toml'), TomlParser.write(manifest));
    fs.writeFileSync(path.join(targetDir, 'mod.ink'), `// ${name} v0.1.0\n\n`);

    console.log(`Created package: ${name}/`);
    console.log('  ink-package.toml');
    console.log('  mod.ink');
  }
}
