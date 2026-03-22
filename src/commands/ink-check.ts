// src/commands/ink-check.ts
import { TomlParser } from '../util/toml.js'
import { AuthoredGrammar } from '../grammar/api.js'
import { validate } from '../grammar/validator.js'
import { join } from 'path'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

export class InkCheckCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'))
    let hasErrors = false

    // Check grammar
    if (manifest.grammar) {
      const grammarOk = await this.checkGrammar(manifest.name, manifest.grammar.entry)
      if (!grammarOk) hasErrors = true
    }

    // Check runtime jar exists
    if (manifest.runtime) {
      const jarPath = join(this.projectDir, manifest.runtime.jar)
      if (!existsSync(jarPath)) {
        console.error(`Runtime jar not found: ${manifest.runtime.jar}`)
        hasErrors = true
      } else {
        console.log(`Runtime jar OK: ${manifest.runtime.jar}`)
      }
    }

    if (!manifest.grammar && !manifest.runtime) {
      console.log('No [grammar] or [runtime] section — scripts-only package')
    }

    if (hasErrors) process.exit(1)
    if (manifest.grammar || manifest.runtime) console.log('Check passed')
  }

  private async checkGrammar(packageName: string, grammarEntry: string): Promise<boolean> {
    const entryPath = join(this.projectDir, grammarEntry)
    const grammarOutputPath = join(tmpdir(), `ink-grammar-check-${Date.now()}.json`)

    const entryUrl = pathToFileURL(entryPath).href
    const wrapperPath = join(tmpdir(), `ink-check-wrapper-${Date.now()}.mjs`)
    writeFileSync(wrapperPath, `
import { writeFileSync } from 'fs';
const m = await import('${entryUrl}');
const result = JSON.stringify(m.default);
writeFileSync('${grammarOutputPath.replace(/\\/g, '\\\\')}', result);
`.trim())

    let defaultExport: AuthoredGrammar
    try {
      try {
        execSync(`npx tsx ${wrapperPath}`, { cwd: this.projectDir, stdio: 'pipe' })
      } catch {
        console.error(`Failed to load grammar file: ${entryPath}`)
        return false
      }
      const content = readFileSync(grammarOutputPath, 'utf8')
      defaultExport = JSON.parse(content)
    } finally {
      try { unlinkSync(wrapperPath) } catch {}
      try { unlinkSync(grammarOutputPath) } catch {}
    }

    if (defaultExport.package !== packageName) {
      console.error(`Package name mismatch: ink-package.toml says '${packageName}' but grammar.ts exports '${defaultExport.package}'`)
      return false
    }

    const errors = validate(defaultExport)
    if (errors.length === 0) {
      console.log('Grammar OK — no errors found')
      return true
    } else {
      console.error('Grammar errors found:')
      for (const err of errors) {
        console.error(`  [${err.type}] ${err.ruleName}: ${err.detail}`)
      }
      return false
    }
  }
}
