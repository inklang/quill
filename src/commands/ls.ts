import { TomlParser } from '../util/toml.js';
import path from 'path';
import fs from 'fs';

export interface LsEntry {
  name: string;
  version: string;
  invalid?: boolean;
}

export class LsCommand {
  constructor(private projectDir: string) {}

  async run(outputJson: boolean = false): Promise<void> {
    const packagesDir = path.join(this.projectDir, 'packages');
    if (!fs.existsSync(packagesDir)) {
      if (outputJson) {
        console.log(JSON.stringify({ packages: [], total: 0 }));
      } else {
        console.log('No packages installed.');
      }
      return;
    }

    const entries: LsEntry[] = fs.readdirSync(packagesDir)
      .filter(f => fs.statSync(path.join(packagesDir, f)).isDirectory())
      .map(name => {
        const inkPackageToml = path.join(packagesDir, name, 'ink-package.toml');
        if (fs.existsSync(inkPackageToml)) {
          try {
            const manifest = TomlParser.read(inkPackageToml);
            return { name: manifest.name, version: manifest.version ?? 'unknown' } as LsEntry;
          } catch {
            return { name, version: '', invalid: true } as LsEntry;
          }
        }
        return { name, version: '', invalid: true } as LsEntry;
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    if (outputJson) {
      console.log(JSON.stringify({ packages: entries, total: entries.length }));
      return;
    }

    if (entries.length === 0) {
      console.log('No packages installed.');
    } else {
      console.log(`Installed packages (${entries.length}):`);
      for (const e of entries) {
        if (e.invalid) {
          console.log(`  ${e.name} (invalid ink-package.toml)`);
        } else {
          console.log(`  ${e.name} v${e.version}`);
        }
      }
    }
  }
}
