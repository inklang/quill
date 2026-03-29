import { TomlParser } from '../util/toml.js'
import { success as splash } from '../ui/ascii.js'
import { RegistryClient } from '../registry/client.js'
import { FileUtils } from '../util/fs.js'
import { InkBuildCommand } from './ink-build.js'
import { readRc } from '../util/keys.js'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

export class PublishCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'))

    if (!manifest.name || !manifest.version) {
      console.error('ink-package.toml must have name and version to publish')
      process.exit(1)
    }

    const rc = readRc()
    if (!rc || !rc.keyId || !rc.privateKey) {
      console.error('Not logged in. Run `quill login` first.')
      process.exit(1)
    }

    const client = new RegistryClient()
    const valid = await client.validateAuth()
    if (!valid) {
      console.error('Session expired or key invalid. Run `quill login` to reauthenticate.')
      process.exit(1)
    }
    const authHeader = client.makeAuthHeader()!

    console.log('Building before publish...')
    const buildCmd = new InkBuildCommand(this.projectDir)
    await buildCmd.run()

    const distDir = join(this.projectDir, 'dist')
    if (!existsSync(distDir)) {
      console.error('dist/ not found after build')
      process.exit(1)
    }

    // Validate entry point for script packages
    const packageType = manifest.type ?? 'script';
    if (packageType === 'script') {
      const mainName = manifest.main;
      if (!mainName) {
        console.error('Script packages must have a "main" entry point in ink-package.toml');
        process.exit(1);
      }
      // Check compiled output exists
      const hasTargets = manifest.targets && Object.keys(manifest.targets).length > 0;
      let mainPath: string;
      if (hasTargets) {
        const targetName = manifest.target ?? Object.keys(manifest.targets!)[0];
        mainPath = join(distDir, targetName, 'scripts', `${mainName}.inkc`);
      } else {
        mainPath = join(distDir, 'scripts', `${mainName}.inkc`);
      }
      if (!existsSync(mainPath)) {
        console.error(`Entry point not found: ${mainPath}`);
        console.error('Script packages require a compiled entry point. Check your "main" field in ink-package.toml.');
        process.exit(1);
      }
    }

    const tarballPath = join(tmpdir(), `${manifest.name}-${manifest.version}.tar.gz`)
    await FileUtils.packTarGz(this.projectDir, tarballPath, ['ink-package.toml', 'dist'])

    const tarball = readFileSync(tarballPath)

    const description: string | undefined = manifest.description
    const readmePath = join(this.projectDir, 'README.md')
    const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf-8') : undefined

    // Send all targets: explicit manifest.target + keys from manifest.targets table
    const targetsToSend = manifest.target
      ? [manifest.target, ...Object.keys(manifest.targets ?? {})]
      : Object.keys(manifest.targets ?? {});

    const url = `${client.registryUrl}/api/packages/${manifest.name}/${manifest.version}`

    // Use custom content-type to avoid Vercel blocking multipart/form-data PUTs
    const headers: Record<string, string> = {
      'Authorization': authHeader,
      'Content-Type': 'application/vnd.ink-publish+gzip',
      'Content-Length': tarball.length.toString(),
    }
    headers['X-Package-Type'] = manifest.type ?? 'script'
    if (description) headers['X-Package-Description'] = description
    if (readme) headers['X-Package-Readme'] = readme
    if (targetsToSend.length > 0) headers['X-Package-Targets'] = JSON.stringify([...new Set(targetsToSend)])

    console.log('PUT', url)
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: tarball,
    })
    console.log('Response:', res.status, res.headers.get('content-type'))

    if (!res.ok) {
      const body = await res.text()
      console.error(`Publish failed (${res.status}): ${body}`)
      process.exit(1)
    }

    splash.publish()
  }
}
