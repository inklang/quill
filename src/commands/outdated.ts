import { TomlParser } from '../util/toml.js'
import { RegistryClient } from '../registry/client.js'
import { Lockfile } from '../lockfile.js'
import { Semver } from '../model/semver.js'
import path from 'path'
import fs from 'fs'

export class OutdatedCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const inkPackageTomlPath = path.join(this.projectDir, 'ink-package.toml')
    if (!fs.existsSync(inkPackageTomlPath)) {
      console.error('No ink-package.toml found. Run `quill init` or `quill new` first.')
      process.exit(1)
    }

    const manifest = TomlParser.read(inkPackageTomlPath)
    const deps: Record<string, string> = manifest.dependencies ?? {}

    if (Object.keys(deps).length === 0) {
      console.log('No dependencies to check.')
      return
    }

    const lockfilePath = path.join(this.projectDir, 'quill.lock')
    let lockfile: Map<string, { version: string }> = new Map()
    if (fs.existsSync(lockfilePath)) {
      try {
        const lf = Lockfile.read(lockfilePath)
        for (const [key, entry] of Object.entries(lf.packages)) {
          lockfile.set(key, { version: entry.version })
        }
      } catch {}
    }

    const client = new RegistryClient()
    const index = await client.fetchIndex()
    const packagesDir = path.join(this.projectDir, 'packages')

    const outdated: { name: string, current: string, latest: string, target: string | undefined }[] = []

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
