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
    if (!rc || !rc.token) {
      console.error('Not logged in. Run `quill login` first.')
      process.exit(1)
    }

    const client = new RegistryClient()
    const tokenValid = await client.validateToken(rc.token)
    if (!tokenValid) {
      console.error('Session expired or token invalid. Run `quill login` to reauthenticate.')
      process.exit(1)
    }

    console.log('Building before publish...')
    const buildCmd = new InkBuildCommand(this.projectDir)
    await buildCmd.run()

    const distDir = join(this.projectDir, 'dist')
    if (!existsSync(distDir)) {
      console.error('dist/ not found after build')
      process.exit(1)
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

    // Build full slug from username and package name
    const slug = `${rc.username}/${manifest.name}`
    const url = `${client.registryUrl}/api/packages/${slug}/${manifest.version}`

    // Use custom content-type to avoid Vercel blocking multipart/form-data PUTs
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${rc.token}`,
      'Content-Type': 'application/vnd.ink-publish+gzip',
      'Content-Length': tarball.length.toString(),
    }
    if (description) headers['X-Package-Description'] = description
    if (readme) headers['X-Package-Readme'] = readme
    if (targetsToSend.length > 0) headers['X-Package-Targets'] = JSON.stringify([...new Set(targetsToSend)])

    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: tarball,
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Publish failed (${res.status}): ${body}`)
      process.exit(1)
    }

    splash.publish()
  }
}
