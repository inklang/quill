// src/commands/ink-check.ts
import { TomlParser } from '../util/toml.js'
import { AuthoredGrammar } from '../grammar/api.js'
import { validate } from '../grammar/validator.js'
import { join } from 'path'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

export class InkCheckCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'))

    if (!manifest.grammar) {
      console.error('No [grammar] section in ink-package.toml')
      process.exit(1)
    }

    const entryPath = join(this.projectDir, manifest.grammar.entry)
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
        process.exit(1)
      }
      const content = readFileSync(grammarOutputPath, 'utf8')
      defaultExport = JSON.parse(content)
    } finally {
      try { unlinkSync(wrapperPath) } catch {}
      try { unlinkSync(grammarOutputPath) } catch {}
    }

    // Validate package name matches
    if (defaultExport.package !== manifest.name) {
      console.error(`Package name mismatch: ink-package.toml says '${manifest.name}' but grammar.ts exports '${defaultExport.package}'`)
      process.exit(1)
    }

    const errors = validate(defaultExport)
    if (errors.length === 0) {
      console.log('Grammar OK — no errors found')
    } else {
      console.error('Grammar errors found:')
      for (const err of errors) {
        console.error(`  [${err.type}] ${err.ruleName}: ${err.detail}`)
      }
      process.exit(1)
    }
  }
}
