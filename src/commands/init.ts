import { TomlParser } from '../util/toml.js';
import { PackageManifest } from '../model/manifest.js';
import path from 'path';
import fs from 'fs';

export class InitCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const quillToml = path.join(this.projectDir, 'quill.toml');
    if (fs.existsSync(quillToml)) {
      console.log('quill.toml already exists.');
      return;
    }

    const name = path.basename(this.projectDir).toLowerCase();
    const manifest: PackageManifest = {
      name,
      version: '0.1.0',
      entry: 'main',
      dependencies: {},
    };

    TomlParser.write(manifest, quillToml);
    console.log(`Created quill.toml: ${name} v0.1.0`);
  }
}
