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

    const boundary = '----QuillPublishBoundary'
    const parts: Buffer[] = []

    // tarball part
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="tarball"; filename="package.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n`
    ))
    parts.push(tarball)
    parts.push(Buffer.from('\r\n'))

    if (description) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${description}\r\n`
      ))
    }

    if (readme) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="readme"\r\n\r\n${readme}\r\n`
      ))
    }

    // Send all targets: explicit manifest.target + keys from manifest.targets table
    const targetsToSend = manifest.target
      ? [manifest.target, ...Object.keys(manifest.targets ?? {})]
      : Object.keys(manifest.targets ?? []);
    if (targetsToSend.length > 0) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="targets"\r\n\r\n${JSON.stringify([...new Set(targetsToSend)])}\r\n`
      ))
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`))
    const body = Buffer.concat(parts)

    const client = new RegistryClient()
    const url = `${client.registryUrl}/api/packages/${manifest.name}/${manifest.version}`

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Authorization': `Bearer ${rc.token}`,
      },
      body,
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Publish failed (${res.status}): ${body}`)
      process.exit(1)
    }

    splash.publish()
  }
}
