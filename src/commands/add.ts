import { TomlParser } from '../util/toml.js';
import { RegistryClient } from '../registry/client.js';
import { FileUtils } from '../util/fs.js';
import { SemverRange } from '../model/semver.js';
import path from 'path';
import fs from 'fs';

export class AddCommand {
  constructor(private projectDir: string) {}

  async run(pkgSpec: string): Promise<void> {
    const [pkgName, version] = pkgSpec.includes('@')
      ? pkgSpec.split('@')
      : [pkgSpec, null];

    const range = version ? new SemverRange(`^${version}`) : new SemverRange('>=0.0.0');
    const quillTomlPath = path.join(this.projectDir, 'quill.toml');

    const manifest = fs.existsSync(quillTomlPath)
      ? TomlParser.read(quillTomlPath)
      : { name: path.basename(this.projectDir), version: '0.1.0', entry: 'main', dependencies: {} };

    if (pkgName in manifest.dependencies) {
      console.log(`${pkgName} is already in dependencies.`);
      return;
    }

    const client = new RegistryClient();
    const index = await client.fetchIndex();
    const pkgVersion = client.findBestMatch(index, pkgName, range.toString());

    if (!pkgVersion) {
      console.log(`No version of ${pkgName} satisfies ${version ?? 'any version'}`);
      return;
    }

    const packagesDir = path.join(this.projectDir, 'packages');
    const pkgDir = path.join(packagesDir, pkgName.replace('/', '-'));

    if (fs.existsSync(pkgDir)) {
      console.log(`${pkgName} is already installed.`);
      return;
    }

    console.log(`Installing ${pkgName} v${pkgVersion.version}...`);

    const cacheDir = path.join(this.projectDir, '.quill-cache');
    FileUtils.ensureDir(cacheDir);
    const tarball = path.join(cacheDir, `${pkgName.replace('/', '-')}-${pkgVersion.version}.tar.gz`);

    await FileUtils.downloadFile(pkgVersion.url, tarball);
    await FileUtils.extractTarGz(tarball, pkgDir);

    // Update quill.toml
    const updated = { ...manifest, dependencies: { ...manifest.dependencies, [pkgName]: `^${pkgVersion.version}` } };
    TomlParser.write(updated, quillTomlPath);

    console.log(`Installed ${pkgName} v${pkgVersion.version} → packages/${pkgName.replace('/', '-')}`);
  }
}
