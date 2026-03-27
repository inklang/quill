import { TomlParser } from '../util/toml.js';
import { RegistryClient } from '../registry/client.js';
import { FileUtils } from '../util/fs.js';
import { Lockfile, LockfileEntry } from '../lockfile.js';
import { Semver } from '../model/semver.js';
import { SemverRange } from '../model/semver.js';
import { Spinner } from '../ui/spinner.js';
import { cli } from '../ui/colors.js';
import path from 'path';
import fs from 'fs';

export interface InstallOptions {
  dryRun?: boolean
  verbose?: boolean
}

interface ResolvedPkg {
  name: string
  range: string
  version: string
  url: string
  targets?: string[]
  installed: boolean
}

export class InstallCommand {
  constructor(private projectDir: string) {}

  async run(opts: InstallOptions = {}): Promise<void> {
    const inkPackageTomlPath = path.join(this.projectDir, 'ink-package.toml');
    if (!fs.existsSync(inkPackageTomlPath)) {
      console.log('No ink-package.toml found. Run `quill init` or `quill new` first.');
      return;
    }

    const manifest = TomlParser.read(inkPackageTomlPath);
    const client = new RegistryClient();
    const spinner = new Spinner();

    spinner.start('Fetching registry index...');
    const index = await client.fetchIndex();
    spinner.succeed('Registry index fetched.');

    const lockfilePath = path.join(this.projectDir, 'quill.lock')
    const packagesDir = path.join(this.projectDir, 'packages');
    const cacheDir = path.join(this.projectDir, '.quill-cache');

    // Read existing lockfile
    let existingLockfile: Map<string, LockfileEntry> = new Map();
    if (fs.existsSync(lockfilePath)) {
      try {
        const existing = Lockfile.read(lockfilePath);
        for (const [k, v] of Object.entries(existing.packages)) {
          existingLockfile.set(k, v);
        }
      } catch {}
    }

    // Resolve all deps first (sequential for correctness)
    console.log(`Resolving dependencies for ${manifest.name}...`);
    const resolved: ResolvedPkg[] = [];

    for (const [depName, depRange] of Object.entries(manifest.dependencies)) {
      let pkgVersion = null;
      const semverRange = new SemverRange(depRange);

      // Try locked version first
      for (const [lockKey, lockEntry] of existingLockfile.entries()) {
        if (!lockKey.startsWith(`${depName}@`)) continue;
        const lockedVer = lockEntry.version;
        try {
          const parsed = Semver.parse(lockedVer);
          if (semverRange.matches(parsed)) {
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

      // Target validation
      const projectTarget = manifest.target;
      if (projectTarget && pkgVersion.targets && !pkgVersion.targets.includes(projectTarget)) {
        console.error(`Error: Package ${depName}@${pkgVersion.version} does not support target "${projectTarget}".`);
        console.error(`       Available targets: ${pkgVersion.targets.join(', ')}`);
        return;
      }

      const pkgDir = path.join(packagesDir, depName.replace('/', '-'));
      resolved.push({
        name: depName,
        range: depRange,
        version: pkgVersion.version,
        url: pkgVersion.url,
        targets: pkgVersion.targets,
        installed: fs.existsSync(pkgDir),
      });

      if (opts.verbose) {
        console.log(`  ${cli.bold(depName)}@^${pkgVersion.version} ${fs.existsSync(pkgDir) ? cli.muted('(already installed)') : ''}`);
        console.log(`    URL: ${pkgVersion.url}`);
      }
    }

    if (resolved.length === 0) {
      console.log('No dependencies to install.');
    }

    // Dry run — show what would happen and exit
    if (opts.dryRun) {
      console.log(`\n[dry-run] Would install ${resolved.filter(r => !r.installed).length} new package(s):`);
      for (const r of resolved) {
        if (!r.installed) {
          console.log(`  ${r.name}@${r.version}`);
        }
      }
      return;
    }

    // Download packages in parallel (concurrency limit of 3)
    const toDownload = resolved.filter(r => !r.installed);
    if (toDownload.length > 0) {
      console.log(`Installing ${toDownload.length} package(s)...`);
      FileUtils.ensureDir(cacheDir);

      const BATCH = 3;
      for (let i = 0; i < toDownload.length; i += BATCH) {
        const batch = toDownload.slice(i, i + BATCH);
        await Promise.all(batch.map(async (pkg) => {
          const tarball = path.join(cacheDir, `${pkg.name.replace('/', '-')}-${pkg.version}.tar.gz`);
          await FileUtils.downloadFile(pkg.url, tarball);
          return pkg;
        }));
        // Show progress after batch completes
        console.log(`  ${cli.success('✓')} ${batch.map(p => `${p.name}@${p.version}`).join(', ')}`);
      }
    }

    // Extract all packages sequentially (safe to parallelize but keeping simple)
    for (const pkg of resolved) {
      if (pkg.installed) continue;

      const pkgDir = path.join(packagesDir, pkg.name.replace('/', '-'));
      const tarball = path.join(cacheDir, `${pkg.name.replace('/', '-')}-${pkg.version}.tar.gz`);
      const extractDir = path.join(cacheDir, `extract-${pkg.name.replace('/', '-')}-${pkg.version}`);

      await FileUtils.extractTarGz(tarball, extractDir);

      const projectTarget = manifest.target;
      let targetDir: string | null = null;

      if (projectTarget) {
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
        await FileUtils.extractTarGz(tarball, pkgDir);
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
    }

    // Write lockfile
    const lockedPkgs: Record<string, LockfileEntry> = {};
    for (const r of resolved) {
      lockedPkgs[`${r.name}@${r.version}`] = new LockfileEntry(r.version, r.url);
    }
    const lockfile = new Lockfile(client.registryUrl, lockedPkgs);
    lockfile.write(lockfilePath);

    const newCount = resolved.filter(r => !r.installed).length;
    if (newCount > 0) {
      console.log(`${cli.success('✓')} Installed ${newCount} new package(s).`);
    } else {
      console.log('All packages already installed.');
    }
  }
}
