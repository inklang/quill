import fs from 'fs'
import path from 'path'
import os from 'os'
import { TomlParser } from './toml.js'
import { RegistryClient } from '../registry/client.js'
import { readRc } from './keys.js'

export type CheckStatus = 'pass' | 'fail' | 'warn'

export interface CheckResult {
  name: string
  status: CheckStatus
  message: string
  fix?: string
}

export class Doctor {
  private results: CheckResult[] = []

  async runAll(): Promise<CheckResult[]> {
    await this.checkRegistry()
    this.checkAuth()
    this.checkProject()
    await this.checkDependencies()
    await this.checkNvidiaApi()
    return this.results
  }

  private addResult(name: string, status: CheckStatus, message: string, fix?: string) {
    this.results.push({ name, status, message, fix })
  }

  private async checkRegistry() {
    try {
      const client = new RegistryClient()
      await client.fetchIndex()
      this.addResult('Registry', 'pass', 'reachable')
    } catch (e: any) {
      this.addResult('Registry', 'fail', `unreachable: ${e.message}`, 'Check your network connection and QUILL_REGISTRY / LECTERN_REGISTRY env var.')
    }
  }

  private checkAuth() {
    const envToken = process.env['QUILL_TOKEN']
    const rc = readRc()
    const hasToken = !!(envToken || rc?.token)

    if (hasToken) {
      this.addResult('Auth', 'pass', 'token found')
    } else {
      this.addResult('Auth', 'warn', 'no token found (run `quill login` to publish)', 'Run `quill login` to authenticate with the registry.')
    }
  }

  private checkProject() {
    const projectDir = process.cwd()
    const tomlPath = path.join(projectDir, 'ink-package.toml')

    if (!fs.existsSync(tomlPath)) {
      this.addResult('ink-package.toml', 'warn', 'not in a project directory', 'Run `quill init` or `quill new <name>` to create a project.')
      return
    }

    try {
      TomlParser.read(tomlPath)
      this.addResult('ink-package.toml', 'pass', 'valid')
    } catch {
      this.addResult('ink-package.toml', 'fail', 'parse error', 'Check ink-package.toml for syntax errors.')
    }
  }

  private async checkDependencies() {
    const projectDir = process.cwd()
    const lockPath = path.join(projectDir, 'quill.lock')

    if (!fs.existsSync(lockPath)) {
      this.addResult('Dependencies', 'pass', 'no dependencies')
      return
    }

    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      const deps = lock.packages ? Object.keys(lock.packages) : Object.keys(lock)

      if (deps.length === 0) {
        this.addResult('Dependencies', 'pass', 'no dependencies')
        return
      }

      const client = new RegistryClient()
      const index = await client.fetchIndex()

      let allFound = true
      for (const dep of deps) {
        // Handle both Map and Proxy returned by fetchIndex
        let found = false
        if (index instanceof Map) {
          found = index.has(dep)
        } else {
          found = dep in (index as any)
        }
        if (!found) {
          allFound = false
          break
        }
      }

      if (allFound) {
        this.addResult('Dependencies', 'pass', 'all installed')
      } else {
        this.addResult('Dependencies', 'warn', 'some deps not found in registry', 'Packages may have been unlisted. Run `quill install` to reinstall.')
      }
    } catch {
      this.addResult('Dependencies', 'warn', 'could not check')
    }
  }

  private async checkNvidiaApi() {
    try {
      const res = await fetch('https://api.nvcf.nvidia.com/v2/info', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      })
      if (res.ok) {
        this.addResult('NVIDIA API', 'pass', 'reachable')
      } else {
        this.addResult('NVIDIA API', 'warn', 'unreachable', 'Set NVIDIA_API_KEY env var for semantic search features.')
      }
    } catch {
      this.addResult('NVIDIA API', 'warn', 'unreachable (search features may not work)', 'Set NVIDIA_API_KEY env var for semantic search features.')
    }
  }

  printResults() {
    const maxNameLen = Math.max(...this.results.map(r => r.name.length), 10)
    const indent = '  '

    console.log('Doctor check results:')
    for (const r of this.results) {
      const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '⚠'
      const name = r.name.padEnd(maxNameLen)
      console.log(`${indent}${icon} ${name}  ${r.message}`)
      if (r.fix && r.status !== 'pass') {
        console.log(`${indent}  → ${r.fix}`)
      }
    }

    const passed = this.results.filter(r => r.status === 'pass').length
    const warnings = this.results.filter(r => r.status === 'warn').length
    const failed = this.results.filter(r => r.status === 'fail').length
    console.log(`\n${this.results.length} checks, ${passed} passed, ${warnings} warning, ${failed} failed`)
  }

  hasFailed(): boolean {
    return this.results.some(r => r.status === 'fail')
  }
}
