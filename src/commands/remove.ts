import { TomlParser } from '../util/toml.js';
import { FileUtils } from '../util/fs.js';
import path from 'path';
import fs from 'fs';

export class RemoveCommand {
  constructor(private projectDir: string) {}

  async run(pkgName: string): Promise<void> {
    const inkPackageTomlPath = path.join(this.projectDir, 'ink-package.toml');
    const pkgDir = path.join(this.projectDir, 'packages', pkgName.replace('/', '-'));

    if (!fs.existsSync(pkgDir) && !fs.existsSync(inkPackageTomlPath)) {
      console.log(`${pkgName} is not installed.`);
      return;
    }

    if (fs.existsSync(pkgDir)) {
      FileUtils.deleteDirectory(pkgDir);
    }

    if (fs.existsSync(inkPackageTomlPath)) {
      const manifest = TomlParser.read(inkPackageTomlPath);
      if (pkgName in manifest.dependencies) {
        const updated = {
          ...manifest,
          dependencies: Object.fromEntries(
            Object.entries(manifest.dependencies).filter(([k]) => k !== pkgName)
          ),
        };
        fs.writeFileSync(inkPackageTomlPath, TomlParser.write(updated));
      }
    }

    console.log(`Removed ${pkgName}.`);
  }
}
