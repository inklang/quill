import { TomlParser } from '../util/toml.js';
import { PackageManifest } from '../model/manifest.js';
import path from 'path';
import fs from 'fs';

export class InitCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const inkPackageToml = path.join(this.projectDir, 'ink-package.toml');
    if (fs.existsSync(inkPackageToml)) {
      console.log('ink-package.toml already exists.');
      return;
    }

    const name = path.basename(this.projectDir).toLowerCase();
    const manifest: PackageManifest = {
      name,
      version: '0.1.0',
      entry: 'main',
      dependencies: {},
    };

    fs.writeFileSync(inkPackageToml, TomlParser.write(manifest));
    console.log(`Created ink-package.toml: ${name} v0.1.0`);
  }
}
