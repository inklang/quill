import { TomlParser } from '../util/toml.js';
import { RegistryClient } from '../registry/client.js';
import { FileUtils } from '../util/fs.js';
import { Lockfile, LockfileEntry } from '../lockfile.js';
import { Semver } from '../model/semver.js';
import { SemverRange } from '../model/semver.js';
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
    const lockfilePath = path.join(this.projectDir, 'quill.lock')

    console.log(`Resolving dependencies for ${manifest.name}...`);

    const lockedPkgs: Record<string, LockfileEntry> = {};
    const packagesDir = path.join(this.projectDir, 'packages');

    // Read existing lockfile if present
    let existingLockfile: Map<string, LockfileEntry> = new Map();
    if (fs.existsSync(lockfilePath)) {
      try {
        const existing = Lockfile.read(lockfilePath);
        for (const [k, v] of Object.entries(existing.packages)) {
          existingLockfile.set(k, v);
        }
      } catch {}
    }

    for (const [depName, depRange] of Object.entries(manifest.dependencies)) {
      // Try to use locked version first (deterministic install)
      let pkgVersion = null;
      const semverRange = new SemverRange(depRange);

      for (const [lockKey, lockEntry] of existingLockfile.entries()) {
        if (!lockKey.startsWith(`${depName}@`)) continue;
        const lockedVer = lockEntry.version;
        try {
          const parsed = Semver.parse(lockedVer);
          if (semverRange.matches(parsed)) {
            // Use the locked version — resolve fresh to get the URL but pin to locked version
            const fresh = client.findBestMatch(index, depName, depRange);
            if (fresh && fresh.version === lockedVer) {
              pkgVersion = fresh;
            }
          }
        } catch {}
      }

      // Fall back to latest satisfying version
      if (!pkgVersion) {
        pkgVersion = client.findBestMatch(index, depName, depRange);
      }

      if (!pkgVersion) {
        console.error(`ERROR: No version of ${depName} satisfies ${depRange}`);
        return;
      }

      // Target validation (same pattern as AddCommand)
      const projectTarget = manifest.target;
      if (projectTarget && pkgVersion.targets && !pkgVersion.targets.includes(projectTarget)) {
        console.error(`Error: Package ${depName}@${pkgVersion.version} does not support target "${projectTarget}".`);
        console.error(`       Available targets: ${pkgVersion.targets.join(', ')}`);
        return;
      }

      const pkgDir = path.join(packagesDir, depName.replace('/', '-'));
      if (!fs.existsSync(pkgDir)) {
        console.log(`Installing ${depName} v${pkgVersion.version}...`);
        const cacheDir = path.join(this.projectDir, '.quill-cache');
        FileUtils.ensureDir(cacheDir);
        const tarball = path.join(cacheDir, `${depName.replace('/', '-')}-${pkgVersion.version}.tar.gz`);
        await FileUtils.downloadFile(pkgVersion.url, tarball);

        // Extract only the matching target subfolder
        const extractDir = path.join(cacheDir, `extract-${depName.replace('/', '-')}-${pkgVersion.version}`);
        await FileUtils.extractTarGz(tarball, extractDir);

        const projTarget = manifest.target;
        let targetDir: string | null = null;

        if (projTarget) {
          // Find the target subfolder
          const entries = fs.readdirSync(extractDir);
          for (const entry of entries) {
            const manifestPath = path.join(extractDir, entry, 'ink-manifest.json');
            if (fs.existsSync(manifestPath)) {
              const pkgManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              if (pkgManifest.target === projTarget) {
                targetDir = entry;
                break;
              }
            }
          }

          if (!targetDir) {
            console.error(`Error: Could not find variant for target "${projTarget}" in package tarball.`);
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
      }

      lockedPkgs[`${depName}@${pkgVersion.version}`] = new LockfileEntry(
        pkgVersion.version,
        pkgVersion.url
      );
    }

    const lockfile = new Lockfile(client.registryUrl, lockedPkgs);
    lockfile.write(lockfilePath);

    console.log(`Installed ${Object.keys(lockedPkgs).length} package(s).`);
  }
}
