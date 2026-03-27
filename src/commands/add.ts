import { TomlParser } from '../util/toml.js';
import { RegistryClient } from '../registry/client.js';
import { FileUtils } from '../util/fs.js';
import { Lockfile, LockfileEntry } from '../lockfile.js';
import { VulnerabilitiesScanner } from '../audit/vulnerabilities.js';
import { ChecksumVerifier } from '../audit/checksum.js';
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

    const pkgVersion = client.findBestMatch(index, pkgName, rangeStr);

    if (!pkgVersion) {
      console.log(`No version of ${pkgName} satisfies ${version ?? 'any version'}`);
      return;
    }

    // Dry run — show what would happen and exit
    if (opts.dryRun) {
      console.log(`[dry-run] Would install ${pkgName}@${pkgVersion.version}`);
      if (opts.verbose) {
        console.log(`  URL: ${pkgVersion.url}`);
        if (pkgVersion.checksum) console.log(`  Checksum: ${pkgVersion.checksum}`);
      }
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
    if (opts.verbose) console.log(`  URL: ${pkgVersion.url}`);

    const cacheDir = path.join(this.projectDir, '.quill-cache');
    FileUtils.ensureDir(cacheDir);
    const tarball = path.join(cacheDir, `${pkgName.replace('/', '-')}-${pkgVersion.version}.tar.gz`);

    spinner.start(`Downloading ${pkgName}@${pkgVersion.version}...`);
    await FileUtils.downloadFile(pkgVersion.url, tarball);
    spinner.succeed(`Downloaded ${pkgName}@${pkgVersion.version}.`);

    // Compute checksum and verify
    spinner.start('Verifying checksum...');
    const computedChecksum = await this.computeTarballSha256(tarball)
    if (opts.verbose) console.log(`  Computed: ${computedChecksum}`);
    if (pkgVersion.checksum) {
      if (opts.verbose) console.log(`  Expected: ${pkgVersion.checksum}`);
      const verifier = new ChecksumVerifier()
      const result = await verifier.verify(tarball, pkgVersion.checksum)
      if (!result.valid) {
        spinner.fail(`Checksum mismatch for ${pkgName}@${pkgVersion.version}`);
        console.error(`  Expected (registry): ${pkgVersion.checksum}`);
        console.error(`  Computed:            ${computedChecksum}`);
        console.error('  Package may have been tampered with. DO NOT INSTALL.');
        fs.rmSync(tarball, { force: true })
        process.exit(2)
      }
    }
    spinner.succeed('Checksum verified.');

    // Vulnerability audit
    if (!opts.force) {
      const auditResult = await this.runVulnerabilityAudit(pkgName, pkgVersion.version, pkgVersion.dependencies, opts)
      if (auditResult.blocked) {
        console.error('Aborted.')
        fs.rmSync(tarball, { force: true })
        process.exit(1)
      }
    }

    // Extract only the matching target subfolder
    const extractDir = path.join(cacheDir, `extract-${pkgName.replace('/', '-')}-${pkgVersion.version}`);
    spinner.start('Extracting package...');
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
        spinner.fail(`Could not find variant for target "${projectTarget}" in package tarball.`);
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

    // Update ink-package.toml
    const versionStr = opts.saveExact ? pkgVersion.version : `^${pkgVersion.version}`;
    const updated = { ...manifest, dependencies: { ...manifest.dependencies, [pkgName]: versionStr } };
    fs.writeFileSync(inkPackageTomlPath, TomlParser.write(updated));

    // Update quill.lock
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
    lockedPkgs[`${pkgName}@${pkgVersion.version}`] = new LockfileEntry(pkgVersion.version, pkgVersion.url)
    const lockfile = new Lockfile(new RegistryClient().registryUrl, lockedPkgs)
    lockfile.write(lockfilePath)

    console.log(`${cli.success('✓')} Installed ${pkgName} v${pkgVersion.version} → packages/${pkgName.replace('/', '-')}`);
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
