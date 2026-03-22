// src/commands/ink-build.ts
import { TomlParser } from '../util/toml.js'
import { AuthoredGrammar } from '../grammar/api.js'
import { serialize } from '../grammar/serializer.js'
import { validate } from '../grammar/validator.js'
import { writeFileSync, mkdirSync, unlinkSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

export class InkBuildCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'))

    if (!manifest.grammar) {
      console.error('No [grammar] section in ink-package.toml')
      process.exit(1)
    }

    const entryPath = join(this.projectDir, manifest.grammar.entry)
    const outputPath = join(this.projectDir, manifest.grammar.output)

    // tsx needs a file on disk to run with ESM, so we write a small wrapper to
    // the system's temp directory, execute it with tsx, then read the result.
    const wrapperPath = join(tmpdir(), `ink-grammar-wrapper-${Date.now()}.mjs`)
    const grammarOutputPath = join(tmpdir(), `ink-grammar-output-${Date.now()}.json`)

    const entryUrl = pathToFileURL(entryPath).href
    writeFileSync(wrapperPath, `
import { writeFileSync } from 'fs';
const m = await import('${entryUrl}');
const result = JSON.stringify(m.default);
writeFileSync('${grammarOutputPath.replace(/\\/g, '\\\\')}', result);
`.trim())

    try {
      execSync(`npx tsx ${wrapperPath}`, { cwd: this.projectDir, stdio: 'pipe' })
    } catch (e) {
      console.error(`Failed to load grammar file: ${entryPath}`)
      process.exit(1)
    } finally {
      try { unlinkSync(wrapperPath) } catch {}
    }

    let defaultExport: AuthoredGrammar
    try {
      const content = readFileSync(grammarOutputPath, 'utf8')
      defaultExport = JSON.parse(content)
    } catch {
      console.error('Grammar file did not export valid JSON via default')
      process.exit(1)
    } finally {
      try { unlinkSync(grammarOutputPath) } catch {}
    }

    // Validate package name matches
    if (defaultExport.package !== manifest.name) {
      console.error(`Package name mismatch: ink-package.toml says '${manifest.name}' but grammar.ts exports '${defaultExport.package}'`)
      process.exit(1)
    }

    // Validate
    const errors = validate(defaultExport)
    if (errors.length > 0) {
      console.error('Grammar validation errors:')
      for (const err of errors) {
        console.error(`  [${err.type}] ${err.ruleName}: ${err.detail}`)
      }
      process.exit(1)
    }

    // Serialize to IR
    const ir = serialize(defaultExport)

    // Ensure output directory exists
    mkdirSync(dirname(outputPath), { recursive: true })

    // Write IR JSON
    writeFileSync(outputPath, JSON.stringify(ir, null, 2))
    console.log(`Grammar IR written to ${outputPath}`)
  }
}
