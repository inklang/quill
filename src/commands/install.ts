import { TomlParser } from '../util/toml.js';
import { RegistryClient } from '../registry/client.js';
import { FileUtils } from '../util/fs.js';
import { Lockfile, LockfileEntry } from '../lockfile.js';
import path from 'path';
import fs from 'fs';

export class InstallCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const inkPackageTomlPath = path.join(this.projectDir, 'ink-package.toml');
    if (!fs.existsSync(inkPackageTomlPath)) {
      console.log('No ink-package.toml found. Run `quill init` or `quill new` first.');
      return;
    }

    const manifest = TomlParser.read(inkPackageTomlPath);
    const client = new RegistryClient();
    const index = await client.fetchIndex();

    console.log(`Resolving dependencies for ${manifest.name}...`);

    const lockedPkgs: Record<string, LockfileEntry> = {};
    const packagesDir = path.join(this.projectDir, 'packages');

    for (const [depName, depRange] of Object.entries(manifest.dependencies)) {
      const pkgVersion = client.findBestMatch(index, depName, depRange);
      if (!pkgVersion) {
        console.error(`ERROR: No version of ${depName} satisfies ${depRange}`);
        return;
      }

      const pkgDir = path.join(packagesDir, depName.replace('/', '-'));
      if (!fs.existsSync(pkgDir)) {
        console.log(`Installing ${depName} v${pkgVersion.version}...`);
        const cacheDir = path.join(this.projectDir, '.quill-cache');
        FileUtils.ensureDir(cacheDir);
        const tarball = path.join(cacheDir, `${depName.replace('/', '-')}-${pkgVersion.version}.tar.gz`);
        await FileUtils.downloadFile(pkgVersion.url, tarball);
        await FileUtils.extractTarGz(tarball, pkgDir);
      }

      lockedPkgs[`${depName}@${pkgVersion.version}`] = new LockfileEntry(
        pkgVersion.version,
        pkgVersion.url
      );
    }

    const lockfile = new Lockfile(client.registryUrl, lockedPkgs);
    lockfile.write(path.join(this.projectDir, 'quill.lock'));

    console.log(`Installed ${Object.keys(lockedPkgs).length} package(s).`);
  }
}
