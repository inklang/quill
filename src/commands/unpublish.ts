import { readRc } from '../util/keys.js'
import { RegistryClient } from '../registry/client.js'
import { TomlParser } from '../util/toml.js'
import path from 'path'

export class UnpublishCommand {
  constructor(private projectDir: string) {}

  async run(version?: string): Promise<void> {
    const manifest = TomlParser.read(path.join(this.projectDir, 'ink-package.toml'))

    if (!manifest.name) {
      console.error('ink-package.toml must have a name.')
      process.exit(1)
    }

    const rc = readRc()
    if (!rc || !rc.token) {
      console.error('Not logged in. Run `quill login` first.')
      process.exit(1)
    }

    const targetVersion = version ?? manifest.version
    if (!targetVersion) {
      console.error('No version specified and no version found in ink-package.toml.')
      process.exit(1)
    }

    const client = new RegistryClient()
    const slug = `${rc.username}/${manifest.name}`
    const url = `${client.registryUrl}/api/packages/${slug}/${targetVersion}`

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${rc.token}`,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Unpublish failed (${res.status}): ${body}`)
      process.exit(1)
    }

    console.log(`Unpublished ${manifest.name}@${targetVersion}.`)
  }
}
