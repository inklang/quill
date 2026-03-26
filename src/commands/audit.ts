import { RegistryClient } from '../registry/client.js'
import { VulnerabilitiesScanner } from '../audit/vulnerabilities.js'
import { BytecodeScanner } from '../audit/bytecode.js'
import { ChecksumVerifier } from '../audit/checksum.js'
import path from 'path'
import fs from 'fs'

export interface AuditOptions {
  pkg?: string
  json?: boolean
  offline?: boolean
}

export class AuditCommand {
  private vulnScanner: VulnerabilitiesScanner
  private bytecodeScanner: BytecodeScanner
  private checksumVerifier: ChecksumVerifier
  private packagesDir: string

  constructor(
    private client: RegistryClient,
    vulnScanner?: VulnerabilitiesScanner,
    bytecodeScanner?: BytecodeScanner,
    checksumVerifier?: ChecksumVerifier,
    packagesDir?: string,
  ) {
    this.vulnScanner = vulnScanner ?? new VulnerabilitiesScanner()
    this.bytecodeScanner = bytecodeScanner ?? new BytecodeScanner()
    this.checksumVerifier = checksumVerifier ?? new ChecksumVerifier()
    this.packagesDir = packagesDir ?? path.join(process.cwd(), 'packages')
  }

  async run(opts: AuditOptions): Promise<number> {
    if (opts.json) {
      return this.runJson(opts)
    }
    return this.runText(opts)
  }

  private async runText(opts: AuditOptions): Promise<number> {
    if (!opts.pkg) {
      console.log('Auditing all installed packages...')
      console.log('(Scanning packages/ directory — not yet implemented. Specify a package to audit.)')
      return 0
    }

    const [pkgName, version] = opts.pkg.includes('@')
      ? opts.pkg.split('@')
      : [opts.pkg, undefined]

    const result = await this.auditPackage(pkgName, version, opts.offline ?? false)

    if (result.exitCode === 3) {
      console.error('Audit failed:', result.error)
      return 3
    }

    if (result.exitCode === 0) {
      console.log(`✓ No issues found for ${pkgName}${version ? '@' + version : ''}`)
      return 0
    }

    if (result.exitCode === 2) {
      console.error(`✗ CHECKSUM MISMATCH for ${pkgName}${version ? '@' + version : ''}`)
      console.error(`  Expected (registry): ${result.expectedChecksum}`)
      console.error(`  Computed:            ${result.computedChecksum}`)
      console.error('  Package may have been tampered with. DO NOT INSTALL.')
      return 2
    }

    if (result.vulnerabilities && result.vulnerabilities.length > 0) {
      console.log(`Vulnerabilities found in ${pkgName}${version ? '@' + version : ''}:`)
      for (const v of result.vulnerabilities) {
        console.log(`  ${v.severity}: ${v.id}: ${v.summary}`)
        if (v.references && v.references.length > 0) {
          console.log(`    See: ${v.references[0]}`)
        }
      }
      return 1
    }

    return 0
  }

  private async runJson(opts: AuditOptions): Promise<number> {
    // JSON output is a future enhancement. For now, delegate to text output.
    return this.runText(opts)
  }

  private async auditPackage(pkgName: string, version: string | undefined, offline: boolean): Promise<any> {
    const error = (msg: string) => ({ passed: false, exitCode: 3 as const, error: msg })
    const ok = (extra: any = {}) => ({ passed: true, exitCode: 0 as const, ...extra })

    try {
      const index = await this.client.fetchIndex()
      const resolved = this.client.findBestMatch(index, pkgName, version ? `^${version}` : '*')
      if (!resolved) {
        return error(`Package ${pkgName}${version ? '@' + version : ''} not found in registry`)
      }

      const pkgVersion = resolved.version
      const pkgDir = path.join(this.packagesDir, pkgName.replace('/', '-'))

      // Verify tarball checksum if available
      if (resolved.checksum && fs.existsSync(pkgDir)) {
        const tarballPath = path.join(pkgDir, `${pkgName.replace('/', '-')}-${pkgVersion}.tar.gz`)
        if (fs.existsSync(tarballPath)) {
          const checksumResult = await this.checksumVerifier.verify(tarballPath, resolved.checksum)
          if (!checksumResult.valid) {
            return {
              passed: false,
              exitCode: 2 as const,
              package: pkgName,
              version: pkgVersion,
              expectedChecksum: checksumResult.expected,
              computedChecksum: checksumResult.computed,
            }
          }
        }
      }

      let vulnerabilities: any[] = []
      if (!offline) {
        const deps = Object.entries(resolved.dependencies ?? {})
        for (const [depName, depVersion] of deps) {
          const vulns = await this.vulnScanner.scan(depName, depVersion)
          vulnerabilities.push(...vulns.map(v => ({ ...v, package: depName, version: depVersion })))
        }
      }

      if (fs.existsSync(pkgDir)) {
        const bytecodeIssues = this.scanInstalledBytecode(pkgDir)
        if (bytecodeIssues.length > 0) {
          return { passed: false, exitCode: 1, package: pkgName, version: pkgVersion, bytecodeIssues }
        }
      }

      if (vulnerabilities.length > 0) {
        return { passed: false, exitCode: 1, package: pkgName, version: pkgVersion, vulnerabilities }
      }

      return ok({ package: pkgName, version: pkgVersion })
    } catch (err: any) {
      return error(err.message)
    }
  }

  private scanInstalledBytecode(pkgDir: string): any[] {
    const issues: any[] = []
    const scriptsDir = path.join(pkgDir, 'scripts')
    if (!fs.existsSync(scriptsDir)) return issues

    const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.inkc'))
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(scriptsDir, file), 'utf8')
        const bytecode = JSON.parse(content)
        const fileIssues = this.bytecodeScanner.scan(bytecode)
        for (const issue of fileIssues) {
          issues.push({ file: `scripts/${file}`, ...issue })
        }
      } catch {}
    }
    return issues
  }
}