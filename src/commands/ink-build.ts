// src/commands/ink-build.ts
import { TomlParser } from '../util/toml.js'
import { AuthoredGrammar } from '../grammar/api.js'
import { serialize } from '../grammar/serializer.js'
import { validate } from '../grammar/validator.js'
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, existsSync, copyFileSync } from 'fs'
import { join, dirname, basename } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

export class InkBuildCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'))
    const distDir = join(this.projectDir, 'dist')
    mkdirSync(distDir, { recursive: true })

    const inkManifest: Record<string, unknown> = {
      name: manifest.name,
      version: manifest.version,
    }

    // TODO: compile *.ink → *.inkc to dist/

    // Grammar compilation
    if (manifest.grammar) {
      await this.buildGrammar(manifest.name, manifest.grammar.entry, manifest.grammar.output)
      inkManifest.grammar = 'grammar.ir.json'
    }

    // Runtime jar validation + copy
    if (manifest.runtime) {
      const jarSource = join(this.projectDir, manifest.runtime.jar)
      if (!existsSync(jarSource)) {
        console.error(`Runtime jar not found: ${manifest.runtime.jar} — build it with Gradle first`)
        process.exit(1)
      }
      const jarFilename = basename(manifest.runtime.jar)
      copyFileSync(jarSource, join(distDir, jarFilename))
      inkManifest.runtime = {
        jar: jarFilename,
        entry: manifest.runtime.entry,
      }
      console.log(`Runtime jar copied to dist/${jarFilename}`)
    }

    // Write ink-manifest.json
    writeFileSync(join(distDir, 'ink-manifest.json'), JSON.stringify(inkManifest, null, 2))
    console.log('Wrote dist/ink-manifest.json')
  }

  private async buildGrammar(packageName: string, grammarEntry: string, grammarOutput: string): Promise<void> {
    const entryPath = join(this.projectDir, grammarEntry)
    const outputPath = join(this.projectDir, grammarOutput)

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

    if (defaultExport.package !== packageName) {
      console.error(`Package name mismatch: ink-package.toml says '${packageName}' but grammar.ts exports '${defaultExport.package}'`)
      process.exit(1)
    }

    const errors = validate(defaultExport)
    if (errors.length > 0) {
      console.error('Grammar validation errors:')
      for (const err of errors) {
        console.error(`  [${err.type}] ${err.ruleName}: ${err.detail}`)
      }
      process.exit(1)
    }

    const ir = serialize(defaultExport)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, JSON.stringify(ir, null, 2))
    console.log(`Grammar IR written to ${outputPath}`)
  }
}
