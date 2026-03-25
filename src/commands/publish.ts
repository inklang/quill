import { TomlParser } from '../util/toml.js'
import { success as splash } from '../ui/ascii.js'
import { RegistryClient } from '../registry/client.js'
import { FileUtils } from '../util/fs.js'
import { InkBuildCommand } from './ink-build.js'
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

    const client = new RegistryClient()
    const token = client.readAuthToken()
    if (!token) {
      console.error('Not authenticated. Set QUILL_TOKEN or add token to ~/.quillrc')
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

    const includes = ['ink-package.toml', 'dist']
    const tarball = join(tmpdir(), `${manifest.name}-${manifest.version}.tar.gz`)
    await FileUtils.packTarGz(this.projectDir, tarball, includes)

    const url = `${client.registryUrl}/packages/${manifest.name}/${manifest.version}`
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/gzip',
      },
      body: new Blob([readFileSync(tarball)]),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Publish failed (${res.status}): ${body}`)
      process.exit(1)
    }

    splash.publish()
  }
}
