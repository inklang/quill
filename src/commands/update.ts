import { TomlParser } from '../util/toml.js'
import { RegistryClient } from '../registry/client.js'
import { FileUtils } from '../util/fs.js'
import { Lockfile, LockfileEntry } from '../lockfile.js'
import path from 'path'
import fs from 'fs'

export class UpdateCommand {
  constructor(private projectDir: string) {}

  async run(pkgNames: string[]): Promise<void> {
    const inkPackageTomlPath = path.join(this.projectDir, 'ink-package.toml')
    if (!fs.existsSync(inkPackageTomlPath)) {
      console.error('No ink-package.toml found. Run `quill init` or `quill new` first.')
      process.exit(1)
    }

    const manifest = TomlParser.read(inkPackageTomlPath)
    const deps: Record<string, string> = manifest.dependencies ?? {}

    if (Object.keys(deps).length === 0) {
      console.log('No dependencies to update.')
      return
    }

    // Filter to requested packages, or all if none specified
    const targets = pkgNames.length > 0
      ? pkgNames.filter(n => {
          if (!deps[n]) { console.warn(`${n} is not in dependencies, skipping.`); return false }
          return true
        })
      : Object.keys(deps)

    if (targets.length === 0) return

    const client = new RegistryClient()
    const index = await client.fetchIndex()

    const packagesDir = path.join(this.projectDir, 'packages')
    const cacheDir = path.join(this.projectDir, '.quill-cache')
    const lockedPkgs: Record<string, LockfileEntry> = {}
    const updatedDeps = { ...deps }
    let updatedCount = 0

    for (const depName of targets) {
      const currentRange = deps[depName]
      // Resolve latest matching the existing range
      const pkgVersion = client.findBestMatch(index, depName, currentRange)
      if (!pkgVersion) {
        console.error(`No version of ${depName} satisfies ${currentRange}`)
        continue
      }

      const pkgDir = path.join(packagesDir, depName.replace('/', '-'))
      const alreadyInstalled = fs.existsSync(pkgDir)

      // Check if installed version differs from resolved
      let installedVersion: string | null = null
      const installedManifest = path.join(pkgDir, 'ink-package.toml')
      if (alreadyInstalled && fs.existsSync(installedManifest)) {
        installedVersion = TomlParser.read(installedManifest).version ?? null
      }

      if (installedVersion === pkgVersion.version) {
        console.log(`${depName} v${pkgVersion.version} is already up to date.`)
        updatedDeps[depName] = deps[depName]
      } else {
        if (alreadyInstalled) fs.rmSync(pkgDir, { recursive: true, force: true })
        FileUtils.ensureDir(cacheDir)
        const tarball = path.join(cacheDir, `${depName.replace('/', '-')}-${pkgVersion.version}.tar.gz`)
        console.log(`Updating ${depName} → v${pkgVersion.version}...`)
        await FileUtils.downloadFile(pkgVersion.url, tarball)
        await FileUtils.extractTarGz(tarball, pkgDir)
        updatedCount++
        updatedDeps[depName] = `^${pkgVersion.version}`
      }

      lockedPkgs[`${depName}@${pkgVersion.version}`] = new LockfileEntry(pkgVersion.version, pkgVersion.url)
    }

    // Also carry over any deps we didn't touch
    for (const [dep, range] of Object.entries(deps)) {
      if (!targets.includes(dep)) {
        const pv = client.findBestMatch(index, dep, range)
        if (pv) lockedPkgs[`${dep}@${pv.version}`] = new LockfileEntry(pv.version, pv.url)
      }
    }

    // Only rewrite ink-package.toml if something was actually updated
    if (updatedCount > 0) {
      const updated = { ...manifest, dependencies: updatedDeps }
      fs.writeFileSync(inkPackageTomlPath, TomlParser.write(updated))
    }

    const lockfile = new Lockfile(client.registryUrl, lockedPkgs)
    lockfile.write(path.join(this.projectDir, 'quill.lock'))

    if (updatedCount === 0) {
      console.log('All packages are up to date.')
    } else {
      console.log(`Updated ${updatedCount} package(s).`)
    }
  }
}
