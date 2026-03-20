import { TomlParser } from '../util/toml.js';
import path from 'path';
import fs from 'fs';

export class LsCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const packagesDir = path.join(this.projectDir, 'packages');
    if (!fs.existsSync(packagesDir)) {
      console.log('No packages installed.');
      return;
    }

    const entries = fs.readdirSync(packagesDir)
      .filter(f => fs.statSync(path.join(packagesDir, f)).isDirectory())
      .map(name => {
        const quillToml = path.join(packagesDir, name, 'quill.toml');
        if (fs.existsSync(quillToml)) {
          try {
            const manifest = TomlParser.read(quillToml);
            return `  ${manifest.name} v${manifest.version}`;
          } catch {
            return `  ${name} (invalid quill.toml)`;
          }
        }
        return `  ${name} (no manifest)`;
      })
      .sort();

    if (entries.length === 0) {
      console.log('No packages installed.');
    } else {
      console.log(`Installed packages (${entries.length}):`);
      entries.forEach(e => console.log(e));
    }
  }
}
