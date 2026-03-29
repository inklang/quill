import { TomlParser } from '../util/toml.js';
import { RegistryClient } from '../registry/client.js';
import { FileUtils } from '../util/fs.js';
import { Lockfile, LockfileEntry } from '../lockfile.js';
import { resolveTransitive, type ResolvedPkg } from '../resolve.js';
import { Spinner } from '../ui/spinner.js';
import { cli } from '../ui/colors.js';
import { resolveTargetVersion, checkTargetVersionCompatibility } from '../util/target-version.js';
import type { PackageManifest } from '../model/manifest.js';
import path from 'path';
import fs from 'fs';

export interface InstallOptions {
  dryRun?: boolean
  verbose?: boolean
  targetVersion?: string
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

    // Resolve the full transitive dependency tree
    console.log(`Resolving dependencies for ${manifest.name}...`);
    let resolved: Map<string, ResolvedPkg>;
    try {
      resolved = resolveTransitive(index, manifest.dependencies);
    } catch (err: any) {
      console.error(`ERROR: ${err.message}`);
      return;
    }

    if (resolved.size === 0) {
      console.log('No dependencies to install.');
      // Still write an empty lockfile
      const lockfile = new Lockfile(client.registryUrl, {});
      lockfile.write(lockfilePath);
      return;
    }

    if (opts.verbose) {
      for (const pkg of resolved.values()) {
        const pkgDir = path.join(packagesDir, pkg.name.replace('/', '-'));
        const already = fs.existsSync(pkgDir) ? cli.muted('(already installed)') : '';
        console.log(`  ${cli.bold(pkg.name)}@${pkg.version} ${already}`);
        console.log(`    URL: ${pkg.url}`);
        console.log(`    Range: ${pkg.range}`);
      }
    }

    // Dry run — show what would happen and exit
    if (opts.dryRun) {
      const toInstall = [...resolved.values()].filter(pkg => {
        const pkgDir = path.join(packagesDir, pkg.name.replace('/', '-'));
        return !fs.existsSync(pkgDir);
      });
      console.log(`\n[dry-run] Would install ${toInstall.length} package(s):`);
      for (const pkg of resolved.values()) {
        const pkgDir = path.join(packagesDir, pkg.name.replace('/', '-'));
        const marker = fs.existsSync(pkgDir) ? cli.muted(' (already installed)') : '';
        console.log(`  ${pkg.name}@${pkg.version}${marker}`);
      }
      return;
    }

    // Collect packages that need downloading (skip already-present ones)
    const toDownload = [...resolved.values()].filter(pkg => {
      const pkgDir = path.join(packagesDir, pkg.name.replace('/', '-'));
      return !fs.existsSync(pkgDir);
    });

    // Download packages in parallel (concurrency limit of 3)
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

    // Extract all packages that need installing
    for (const pkg of resolved.values()) {
      const pkgDir = path.join(packagesDir, pkg.name.replace('/', '-'));
      if (fs.existsSync(pkgDir)) continue;

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
          console.error(`Error: Could not find variant for target "${projectTarget}" in ${pkg.name} tarball.`);
          fs.rmSync(extractDir, { recursive: true, force: true });
          continue;
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
        FileUtils.ensureDir(pkgDir);
        for (const entry of fs.readdirSync(extractDir)) {
          const src = path.join(extractDir, entry);
          const dest = path.join(pkgDir, entry);
          fs.cpSync(src, dest, { recursive: true });
        }
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
    }

    // Check target-version compatibility against installed packages
    const activeTarget = manifest.target ?? manifest.build?.target ?? 'default';
    const targetVersion = resolveTargetVersion({
      cliFlag: opts.targetVersion,
      buildConfig: manifest.build?.targetVersion,
      serverPaper: manifest.server?.paper,
      activeTarget,
    });

    if (targetVersion) {
      const depManifests = new Map<string, PackageManifest>();
      const depKeys = Object.keys(manifest.dependencies);
      for (const dirName of fs.readdirSync(packagesDir)) {
        const tomlPath = path.join(packagesDir, dirName, 'ink-package.toml');
        if (!fs.existsSync(tomlPath)) continue;
        const matchedKey = depKeys.find(k => k.replace(/\//g, '-') === dirName);
        if (!matchedKey) continue;
        try {
          depManifests.set(matchedKey, TomlParser.read(tomlPath));
        } catch {
          // Skip packages with unparseable manifests
        }
      }
      const issues = checkTargetVersionCompatibility(manifest, depManifests, activeTarget, targetVersion);
      for (const issue of issues) {
        if (issue.type === 'error') {
          console.error(`Error: ${issue.package}: ${issue.message}`);
        } else {
          console.warn(`Warning: ${issue.package}: ${issue.message}`);
        }
      }
      const errors = issues.filter(i => i.type === 'error');
      if (errors.length > 0) {
        process.exit(1);
      }
    }

    // Warn about deprecated [build].target-version if per-target version also exists
    const activeTargetConfig = manifest.targets?.[activeTarget];
    if (manifest.build?.targetVersion && activeTargetConfig?.targetVersion) {
      console.warn(`Warning: Both [build].target-version and [targets.${activeTarget}].target-version are set.`);
      console.warn('  The per-target value takes precedence. [build].target-version is deprecated.');
    }

    // Write lockfile with ALL resolved packages and their dependency graph
    const lockedPkgs: Record<string, LockfileEntry> = {};
    for (const pkg of resolved.values()) {
      lockedPkgs[`${pkg.name}@${pkg.version}`] = new LockfileEntry(pkg.version, pkg.url, pkg.depKeys);
    }
    const lockfile = new Lockfile(client.registryUrl, lockedPkgs);
    lockfile.write(lockfilePath);

    if (toDownload.length > 0) {
      console.log(`${cli.success('✓')} Installed ${toDownload.length} package(s).`);
    } else {
      console.log('All packages already installed.');
    }
  }
}
