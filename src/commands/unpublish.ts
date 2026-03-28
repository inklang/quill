import { readRc, makeAuthHeader } from '../util/keys.js'
import { RegistryClient } from '../registry/client.js'
import { TomlParser } from '../util/toml.js'
import { Lockfile } from '../lockfile.js'
import path from 'path'
import fs from 'fs'

export class UnpublishCommand {
  constructor(private projectDir: string) {}

  async run(version?: string): Promise<void> {
    const inkPackageTomlPath = path.join(this.projectDir, 'ink-package.toml')
    const manifest = TomlParser.read(inkPackageTomlPath)

    if (!manifest.name) {
      console.error('ink-package.toml must have a name.')
      process.exit(1)
    }

    const rc = readRc()
    if (!rc || !rc.keyId || !rc.privateKey) {
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
        'Authorization': makeAuthHeader(rc.keyId, rc.privateKey),
      },
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Unpublish failed (${res.status}): ${body}`)
      process.exit(1)
    }

    console.log(`Unpublished ${manifest.name}@${targetVersion}.`)

    // Remove from lockfile if present
    const lockfilePath = path.join(this.projectDir, 'quill.lock')
    if (fs.existsSync(lockfilePath)) {
      try {
        const lockfile = Lockfile.read(lockfilePath)
        const pkgKey = `${rc.username}/${manifest.name}`
        if (pkgKey in lockfile.packages) {
          delete lockfile.packages[pkgKey]
          lockfile.write(lockfilePath)
          console.log(`Removed ${pkgKey} from quill.lock.`)
        }
      } catch {
        // Lockfile update is best-effort
      }
    }
  }
}
