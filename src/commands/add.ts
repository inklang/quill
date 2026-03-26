import { TomlParser } from '../util/toml.js';
import { RegistryClient } from '../registry/client.js';
import { FileUtils } from '../util/fs.js';
import path from 'path';
import fs from 'fs';

export class AddCommand {
  constructor(private projectDir: string) {}

  async run(pkgSpec: string): Promise<void> {
    const [pkgName, version] = pkgSpec.includes('@')
      ? pkgSpec.split('@')
      : [pkgSpec, null];

    const rangeStr = version ? `^${version}` : '*';
    const inkPackageTomlPath = path.join(this.projectDir, 'ink-package.toml');

    const manifest = fs.existsSync(inkPackageTomlPath)
      ? TomlParser.read(inkPackageTomlPath)
      : { name: path.basename(this.projectDir), version: '0.1.0', main: 'main', dependencies: {}, target: undefined };

    if (pkgName in manifest.dependencies) {
      console.log(`${pkgName} is already in dependencies.`);
      return;
    }

    const client = new RegistryClient();
    const index = await client.fetchIndex();
    const pkgVersion = client.findBestMatch(index, pkgName, rangeStr);

    if (!pkgVersion) {
      console.log(`No version of ${pkgName} satisfies ${version ?? 'any version'}`);
      return;
    }

    // Target validation
    const projectTarget = manifest.target;
    if (projectTarget && pkgVersion.targets && !pkgVersion.targets.includes(projectTarget)) {
      console.error(`Error: Package ${pkgName}@${pkgVersion.version} does not support target "${projectTarget}".`);
      console.error(`       Available targets: ${pkgVersion.targets.join(', ')}`);
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

    // Extract only the matching target subfolder
    const extractDir = path.join(cacheDir, `extract-${pkgName.replace('/', '-')}-${pkgVersion.version}`);
    await FileUtils.extractTarGz(tarball, extractDir);

    let targetDir: string | null = null;

    if (projectTarget) {
      // Find the target subfolder by reading ink-manifest.json from each subdirectory
      const entries = fs.readdirSync(extractDir);
      for (const entry of entries) {
        const manifestPath = path.join(extractDir, entry, 'ink-manifest.json');
        if (fs.existsSync(manifestPath)) {
          const pkgManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (pkgManifest.target === projectTarget) {
            targetDir = entry;
            break;
          }
        }
      }

      if (!targetDir) {
        console.error(`Error: Could not find variant for target "${projectTarget}" in package tarball.`);
        fs.rmSync(extractDir, { recursive: true, force: true });
        return;
      }

      // Copy only the matching target subfolder contents to packages dir
      const srcDir = path.join(extractDir, targetDir);
      FileUtils.ensureDir(pkgDir);
      for (const file of fs.readdirSync(srcDir)) {
        const srcFile = path.join(srcDir, file);
        const destFile = path.join(pkgDir, file);
        if (fs.statSync(srcFile).isDirectory()) {
          FileUtils.ensureDir(destFile);
          // Use fs.cpSync for recursive directory copy (Node 16+)
          fs.cpSync(srcFile, destFile, { recursive: true });
        } else {
          fs.copyFileSync(srcFile, destFile);
        }
      }
      fs.rmSync(extractDir, { recursive: true, force: true });
    } else {
      // No project target — extract everything (backward compat)
      await FileUtils.extractTarGz(tarball, pkgDir);
      fs.rmSync(extractDir, { recursive: true, force: true });
    }

    // Update ink-package.toml
    const updated = { ...manifest, dependencies: { ...manifest.dependencies, [pkgName]: `^${pkgVersion.version}` } };
    fs.writeFileSync(inkPackageTomlPath, TomlParser.write(updated));

    console.log(`Installed ${pkgName} v${pkgVersion.version} → packages/${pkgName.replace('/', '-')}`);
  }
}
