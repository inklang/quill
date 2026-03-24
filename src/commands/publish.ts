import { TomlParser } from '../util/toml.js'
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

    const client = new RegistryClient()
    const url = `${client.registryUrl}/api/packages/${manifest.name}/${manifest.version}`

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/gzip',
        'Authorization': `Bearer ${rc.token}`,
      },
      body: new Blob([tarball]),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Publish failed (${res.status}): ${body}`)
      process.exit(1)
    }

    console.log(`Published ${manifest.name}@${manifest.version}`)
  }
}
