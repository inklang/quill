import { RegistryClient } from '../registry/client.js'

export class InfoCommand {
  async run(pkgName: string, version?: string, outputJson: boolean = false): Promise<void> {
    const client = new RegistryClient()
    try {
      const info = await client.getPackageInfo(pkgName, version)

      if (!info) {
        console.error(`error: Package "${pkgName}" not found in registry`)
        process.exit(1)
      }

      if (outputJson) {
        console.log(JSON.stringify(info, null, 2))
        return
      }

      console.log(`${info.name}@${info.version}`)
      if (info.description) console.log(`  Description: ${info.description}`)
      console.log(`  Version: ${info.version}`)
      if (Object.keys(info.dependencies).length > 0) {
        const deps = Object.entries(info.dependencies)
          .map(([k, v]) => `${k}@${v}`)
          .join(', ')
        console.log(`  Dependencies: ${deps}`)
      }
      if (info.homepage) console.log(`  Homepage: ${info.homepage}`)
      if (info.targets && info.targets.length > 0) console.log(`  Targets: ${info.targets.join(', ')}`)
    } catch (e: any) {
      console.error(`error: Failed to fetch package info: ${e.message}`)
      process.exit(1)
    }
  }
}
