import { TomlParser } from '../util/toml.js';
import { FileUtils } from '../util/fs.js';
import path from 'path';
import fs from 'fs';

export class RemoveCommand {
  constructor(private projectDir: string) {}

  async run(pkgName: string): Promise<void> {
    const quillTomlPath = path.join(this.projectDir, 'quill.toml');
    if (!fs.existsSync(quillTomlPath)) {
      console.log('No quill.toml found.');
      return;
    }

    const manifest = TomlParser.read(quillTomlPath);
    if (!(pkgName in manifest.dependencies)) {
      console.log(`${pkgName} is not in dependencies.`);
      return;
    }

    const pkgDir = path.join(this.projectDir, 'packages', pkgName.replace('/', '-'));
    if (fs.existsSync(pkgDir)) {
      FileUtils.deleteDirectory(pkgDir);
    }

    const updated = {
      ...manifest,
      dependencies: Object.fromEntries(
        Object.entries(manifest.dependencies).filter(([k]) => k !== pkgName)
      ),
    };
    TomlParser.write(updated, quillTomlPath);

    console.log(`Removed ${pkgName} from dependencies.`);
  }
}
