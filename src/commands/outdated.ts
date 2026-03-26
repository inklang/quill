import { TomlParser } from '../util/toml.js'
import { RegistryClient } from '../registry/client.js'
import { Lockfile } from '../lockfile.js'
import { Semver } from '../model/semver.js'
import path from 'path'
import fs from 'fs'

export interface OutdatedEntry {
  name: string
  current: string
  latest: string
  target?: string
}

export class OutdatedCommand {
  constructor(private projectDir: string) {}

  async run(outputJson: boolean = false): Promise<void> {
    const inkPackageTomlPath = path.join(this.projectDir, 'ink-package.toml')
    if (!fs.existsSync(inkPackageTomlPath)) {
      console.error('No ink-package.toml found. Run `quill init` or `quill new` first.')
      process.exit(1)
    }

    const manifest = TomlParser.read(inkPackageTomlPath)
    const deps: Record<string, string> = manifest.dependencies ?? {}

    if (Object.keys(deps).length === 0) {
      if (outputJson) {
        console.log(JSON.stringify({ outdated: [], total: 0 }))
      } else {
        console.log('No dependencies to check.')
      }
      return
    }

    const client = new RegistryClient()
    const index = await client.fetchIndex()
    const packagesDir = path.join(this.projectDir, 'packages')

    const outdated: OutdatedEntry[] = []

    for (const [depName, depRange] of Object.entries(deps)) {
      const pkgDir = path.join(packagesDir, depName.replace('/', '-'))
      const installedManifest = path.join(pkgDir, 'ink-package.toml')
      const installedVersion = fs.existsSync(installedManifest)
        ? TomlParser.read(installedManifest).version ?? null
        : null

      const latestMatch = client.findBestMatch(index, depName, depRange)

      if (!latestMatch) continue

      if (installedVersion) {
        try {
          const installed = Semver.parse(installedVersion)
          const latest = Semver.parse(latestMatch.version)
          if (latest.compareTo(installed) > 0) {
            outdated.push({
              name: depName,
              current: installedVersion,
              latest: latestMatch.version,
              target: manifest.target,
            })
          }
        } catch {}
      }
    }

    if (outputJson) {
      console.log(JSON.stringify({ outdated, total: outdated.length }))
      return
    }

    if (outdated.length === 0) {
      console.log('All dependencies are up to date.')
      return
    }

    console.log(`Dependencies with newer versions (${outdated.length}):\n`)
    for (const { name, current, latest } of outdated) {
      console.log(`  ${name}`)
      console.log(`    current: ${current}`)
      console.log(`    latest:  ${latest}`)
    }
    console.log(`\nRun \`quill update ${outdated.map(o => o.name).join(' ')}\` to update.`)
  }
}
