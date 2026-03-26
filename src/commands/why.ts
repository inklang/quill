import { TomlParser } from '../util/toml.js'
import { RegistryClient } from '../registry/client.js'
import path from 'path'
import fs from 'fs'

export class WhyCommand {
  constructor(private projectDir: string) {}

  async run(pkgName: string): Promise<void> {
    const inkPackageTomlPath = path.join(this.projectDir, 'ink-package.toml')
    if (!fs.existsSync(inkPackageTomlPath)) {
      console.error('No ink-package.toml found. Run `quill init` or `quill new` first.')
      process.exit(1)
    }

    const manifest = TomlParser.read(inkPackageTomlPath)
    const deps: Record<string, string> = manifest.dependencies ?? {}

    if (!(pkgName in deps)) {
      console.log(`${pkgName} is not a direct dependency of ${manifest.name}.`)
      return
    }

    const pkgDir = path.join(this.projectDir, 'packages', pkgName.replace('/', '-'))
    const installedManifest = path.join(pkgDir, 'ink-package.toml')

    if (!fs.existsSync(installedManifest)) {
      console.log(`${pkgName} is listed in dependencies but is not installed.`)
      console.log(`  Specified as: ${deps[pkgName]}`)
      return
    }

    const pkgMeta = TomlParser.read(installedManifest)
    const version = pkgMeta.version ?? deps[pkgName]

    console.log(`${pkgName}@${version}`)
    console.log(`  Specified as: ${deps[pkgName]}`)
    if (pkgMeta.description) {
      console.log(`  Description: ${pkgMeta.description}`)
    }
    if (pkgMeta.author) {
      console.log(`  Author: ${pkgMeta.author}`)
    }

    // Show transitive deps if any
    if (pkgMeta.dependencies && Object.keys(pkgMeta.dependencies).length > 0) {
      console.log(`  Dependencies:`)
      for (const [dep, range] of Object.entries(pkgMeta.dependencies)) {
        console.log(`    ${dep} ${range}`)
      }
    }
  }
}
