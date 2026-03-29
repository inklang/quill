import { TomlParser } from '../util/toml.js';
import { RegistryClient } from '../registry/client.js';
import { FileUtils } from '../util/fs.js';
import { Lockfile, LockfileEntry } from '../lockfile.js';
import { VulnerabilitiesScanner } from '../audit/vulnerabilities.js';
import { ChecksumVerifier } from '../audit/checksum.js';
import { resolveTransitive, type ResolvedPkg } from '../resolve.js';
import { Spinner } from '../ui/spinner.js';
import { cli } from '../ui/colors.js';
import path from 'path';
import fs from 'fs';
import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import readline from 'readline';

export interface AddOptions {
  force?: boolean
  yes?: boolean
  saveExact?: boolean
  dryRun?: boolean
  verbose?: boolean
}

export class AddCommand {
  constructor(private projectDir: string) {}

  async run(pkgSpec: string, opts: AddOptions = {}): Promise<void> {
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
    const spinner = new Spinner();

    spinner.start('Fetching registry index...');
    const index = await client.fetchIndex();
    spinner.succeed('Registry index fetched.');

    // Resolve transitive dependency tree
    let resolved: Map<string, ResolvedPkg>;
    try {
      resolved = resolveTransitive(index, { [pkgName]: rangeStr });
    } catch (err: any) {
      console.log(`No version of ${pkgName} satisfies ${version ?? 'any version'}`);
      return;
    }

    const directPkg = resolved.get(pkgName);
    if (!directPkg) {
      console.log(`No version of ${pkgName} satisfies ${version ?? 'any version'}`);
      return;
    }

    // Dry run — show what would happen and exit
    if (opts.dryRun) {
      console.log(`[dry-run] Would install the following packages:`);
      for (const pkg of resolved.values()) {
        console.log(`  ${pkg.name}@${pkg.version}`);
        if (opts.verbose) {
          console.log(`    URL: ${pkg.url}`);
          if (pkg.checksum) console.log(`    Checksum: ${pkg.checksum}`);
        }
      }
      return;
    }

    // Target validation (direct package only)
    const projectTarget = manifest.target;
    if (projectTarget && directPkg.targets && !directPkg.targets.includes(projectTarget)) {
      console.error(`Error: Package ${pkgName}@${directPkg.version} does not support target "${projectTarget}".`);
      console.error(`       Available targets: ${directPkg.targets.join(', ')}`);
      return;
    }

    const packagesDir = path.join(this.projectDir, 'packages');
    const pkgDir = path.join(packagesDir, pkgName.replace('/', '-'));

    if (fs.existsSync(pkgDir)) {
      console.log(`${pkgName} is already installed.`);
      return;
    }

    // Vulnerability audit (direct package only)
    const client2 = new RegistryClient();
    const directVersion = client2.findBestMatch(index, pkgName, rangeStr);
    if (!opts.force && directVersion) {
      const auditResult = await this.runVulnerabilityAudit(pkgName, directVersion.version, directVersion.dependencies, opts)
      if (auditResult.blocked) {
        console.error('Aborted.')
        process.exit(1)
      }
    }

    // Download + extract all resolved packages
    const cacheDir = path.join(this.projectDir, '.quill-cache');
    FileUtils.ensureDir(cacheDir);

    // Collect packages that need to be installed (skip already-present ones)
    const toInstall: ResolvedPkg[] = [];
    for (const pkg of resolved.values()) {
      const dir = path.join(packagesDir, pkg.name.replace('/', '-'));
      if (!fs.existsSync(dir)) {
        toInstall.push(pkg);
      } else {
        if (opts.verbose) console.log(`  ${pkg.name}@${pkg.version} already installed, skipping.`);
      }
    }

    if (toInstall.length > 0) {
      console.log(`Installing ${toInstall.length} package(s): ${toInstall.map(p => `${p.name}@${p.version}`).join(', ')}`);

      // Download in batches of 3
      const BATCH = 3;
      for (let i = 0; i < toInstall.length; i += BATCH) {
        const batch = toInstall.slice(i, i + BATCH);
        await Promise.all(batch.map(async (pkg) => {
          const tarball = path.join(cacheDir, `${pkg.name.replace('/', '-')}-${pkg.version}.tar.gz`);
          if (opts.verbose) console.log(`  Downloading ${pkg.name}@${pkg.version} from ${pkg.url}`);
          await FileUtils.downloadFile(pkg.url, tarball);
        }));
      }

      // Verify checksums sequentially — abort all on failure
      for (const pkg of toInstall) {
        const tarball = path.join(cacheDir, `${pkg.name.replace('/', '-')}-${pkg.version}.tar.gz`);
        spinner.start(`Verifying checksum for ${pkg.name}@${pkg.version}...`);
        const computedChecksum = await this.computeTarballSha256(tarball);
        if (pkg.checksum) {
          if (opts.verbose) console.log(`  Computed: ${computedChecksum}, Expected: ${pkg.checksum}`);
          const verifier = new ChecksumVerifier();
          const result = await verifier.verify(tarball, pkg.checksum);
          if (!result.valid) {
            spinner.fail(`Checksum mismatch for ${pkg.name}@${pkg.version}`);
            console.error(`  Expected (registry): ${pkg.checksum}`);
            console.error(`  Computed:            ${computedChecksum}`);
            console.error('  Package may have been tampered with. DO NOT INSTALL.');
            // Clean up all downloaded tarballs for this add
            for (const p of toInstall) {
              const tb = path.join(cacheDir, `${p.name.replace('/', '-')}-${p.version}.tar.gz`);
              fs.rmSync(tb, { force: true });
            }
            process.exit(2);
          }
        }
        spinner.succeed(`Checksum verified for ${pkg.name}@${pkg.version}.`);
      }

      // Extract + install each package
      for (const pkg of toInstall) {
        const tarball = path.join(cacheDir, `${pkg.name.replace('/', '-')}-${pkg.version}.tar.gz`);
        const pkgDestDir = path.join(packagesDir, pkg.name.replace('/', '-'));
        const extractDir = path.join(cacheDir, `extract-${pkg.name.replace('/', '-')}-${pkg.version}`);

        spinner.start(`Extracting ${pkg.name}@${pkg.version}...`);
        await FileUtils.extractTarGz(tarball, extractDir);
        spinner.succeed(`Extracted ${pkg.name}@${pkg.version}.`);

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
            spinner.fail(`Could not find variant for target "${projectTarget}" in ${pkg.name} tarball.`);
            fs.rmSync(extractDir, { recursive: true, force: true });
            continue;
          }

          const srcDir = path.join(extractDir, targetDir);
          FileUtils.ensureDir(pkgDestDir);
          for (const file of fs.readdirSync(srcDir)) {
            const srcFile = path.join(srcDir, file);
            const destFile = path.join(pkgDestDir, file);
            if (fs.statSync(srcFile).isDirectory()) {
              FileUtils.ensureDir(destFile);
              fs.cpSync(srcFile, destFile, { recursive: true });
            } else {
              fs.copyFileSync(srcFile, destFile);
            }
          }
          fs.rmSync(extractDir, { recursive: true, force: true });
        } else {
          FileUtils.ensureDir(pkgDestDir);
          for (const entry of fs.readdirSync(extractDir)) {
            const src = path.join(extractDir, entry);
            const dest = path.join(pkgDestDir, entry);
            fs.cpSync(src, dest, { recursive: true });
          }
          fs.rmSync(extractDir, { recursive: true, force: true });
        }
      }
    }

    // Update ink-package.toml (only the direct package)
    const versionStr = opts.saveExact ? directPkg.version : `^${directPkg.version}`;
    const updated = { ...manifest, dependencies: { ...manifest.dependencies, [pkgName]: versionStr } };
    fs.writeFileSync(inkPackageTomlPath, TomlParser.write(updated));

    // Update quill.lock with ALL resolved packages
    const lockfilePath = path.join(this.projectDir, 'quill.lock')
    let lockedPkgs: Record<string, LockfileEntry> = {}
    if (fs.existsSync(lockfilePath)) {
      try {
        const existing = Lockfile.read(lockfilePath)
        for (const [k, v] of Object.entries(existing.packages)) {
          lockedPkgs[k] = v
        }
      } catch {}
    }
    for (const pkg of resolved.values()) {
      lockedPkgs[`${pkg.name}@${pkg.version}`] = new LockfileEntry(pkg.version, pkg.url, pkg.depKeys)
    }
    const lockfile = new Lockfile(new RegistryClient().registryUrl, lockedPkgs)
    lockfile.write(lockfilePath)

    console.log(`${cli.success('✓')} Installed ${pkgName} v${directPkg.version} → packages/${pkgName.replace('/', '-')}`);
  }

  private async computeTarballSha256(tarballPath: string): Promise<string> {
    const hash = createHash('sha256')
    return new Promise((resolve, reject) => {
      const stream = createReadStream(tarballPath)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`))
      stream.on('error', reject)
    })
  }

  private async runVulnerabilityAudit(pkgName: string, version: string, dependencies: Record<string, string>, opts: AddOptions): Promise<{ blocked: boolean }> {
    const scanner = new VulnerabilitiesScanner()
    const allVulns: any[] = []

    for (const [depName, depVersion] of Object.entries(dependencies)) {
      const vulns = await scanner.scan(depName, depVersion)
      allVulns.push(...vulns.map(v => ({ ...v, package: depName, version: depVersion })))
    }

    if (allVulns.length === 0) return { blocked: false }

    console.log(`${cli.warn('⚠')} Vulnerabilities found in ${pkgName}@${version}:`)
    for (const v of allVulns) {
      console.log(`  ${v.severity} - ${v.id}: ${v.summary}`)
    }

    if (opts.yes) {
      console.log(`${cli.muted('[ skipping confirmation --yes ]')}`);
      return { blocked: false }
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise((resolve) => {
      rl.question('Install anyway? [y/N] ', (answer) => {
        rl.close()
        resolve({ blocked: answer.toLowerCase() !== 'y' })
      })
    })
  }
}
