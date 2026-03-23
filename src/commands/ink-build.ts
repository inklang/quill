// src/commands/ink-build.ts
import { TomlParser } from '../util/toml.js'
import { AuthoredGrammar } from '../grammar/api.js'
import { serialize } from '../grammar/serializer.js'
import { validate } from '../grammar/validator.js'
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, existsSync, copyFileSync, readdirSync } from 'fs'
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

    // Grammar compilation
    if (manifest.grammar) {
      await this.buildGrammar(manifest.name, manifest.grammar.entry, manifest.grammar.output)
      inkManifest.grammar = 'grammar.ir.json'
    }

    // Runtime: Gradle build or external JAR copy
    if (manifest.runtime) {
      const runtimeDir = join(this.projectDir, 'runtime')
      const gradleFile = join(runtimeDir, 'build.gradle.kts')

      if (existsSync(gradleFile)) {
        // Determine gradle command: prefer wrapper, fall back to system gradle
        let gradleCmd = 'gradle'
        const isWindows = process.platform === 'win32'
        const wrapperBat = join(runtimeDir, 'gradlew.bat')
        const wrapperSh = join(runtimeDir, 'gradlew')

        let gradleArgs = 'build'
        if (isWindows && existsSync(wrapperBat)) {
          gradleCmd = wrapperBat
        } else if (existsSync(wrapperSh)) {
          if (isWindows) {
            // On Windows, invoke the bash wrapper via bash
            gradleCmd = 'bash'
            gradleArgs = `"${wrapperSh.replace(/\\/g, '/')}" build`
          } else {
            gradleCmd = wrapperSh
          }
        }

        console.log(`Running Gradle build in runtime/...`)
        try {
          execSync(`"${gradleCmd}" ${gradleArgs}`, { cwd: runtimeDir, stdio: 'pipe' })
        } catch (e: any) {
          const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')
          console.error('Gradle build failed:\n' + output)
          process.exit(1)
        }
        console.log('Gradle build successful')

        // Find output JAR in runtime/build/libs/
        const libsDir = join(runtimeDir, 'build/libs')
        if (!existsSync(libsDir)) {
          console.error('Gradle build produced no output: runtime/build/libs/ not found')
          process.exit(1)
        }
        const jars = readdirSync(libsDir).filter(f => f.endsWith('.jar'))
        if (jars.length === 0) {
          console.error('No JAR found in runtime/build/libs/')
          process.exit(1)
        }
        if (jars.length > 1) {
          console.error(`Multiple JARs found in runtime/build/libs/: ${jars.join(', ')}. Expected exactly one.`)
          process.exit(1)
        }

        const jarFilename = jars[0]
        copyFileSync(join(libsDir, jarFilename), join(distDir, jarFilename))
        inkManifest.runtime = {
          jar: jarFilename,
          entry: manifest.runtime.entry,
        }
        console.log(`Runtime jar copied to dist/${jarFilename}`)
      } else {
        // External JAR path — copy directly
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
    }

    // Compile .ink scripts
    const scriptsDir = join(this.projectDir, 'scripts')
    if (existsSync(scriptsDir)) {
      const inkFiles = readdirSync(scriptsDir).filter(f => f.endsWith('.ink'))
      if (inkFiles.length > 0) {
        const compiler = process.env['INK_COMPILER'] || ''
        if (!compiler) {
          console.error('Ink compiler not found. Set INK_COMPILER or [build] compiler in ink-package.toml.')
          process.exit(1)
        }

        const outDir = join(distDir, 'scripts')
        mkdirSync(outDir, { recursive: true })

        const grammarIrPath = join(distDir, 'grammar.ir.json')
        const javaCmd = (process.env['INK_JAVA'] || 'java').replace(/\\/g, '/')
        const compilerPath = compiler.replace(/\\/g, '/')
        const grammarIrPathFwd = grammarIrPath.replace(/\\/g, '/')
        const scriptsDirFwd = scriptsDir.replace(/\\/g, '/')
        const outDirFwd = outDir.replace(/\\/g, '/')
        try {
          execSync(
            `"${javaCmd}" -jar "${compilerPath}" compile --grammar "${grammarIrPathFwd}" --sources "${scriptsDirFwd}" --out "${outDirFwd}"`,
            { cwd: this.projectDir, stdio: 'pipe', shell: process.env['SHELL'] || true }
          )
        } catch (e: any) {
          const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')
          console.error('Ink compilation failed:\n' + output)
          process.exit(1)
        }

        const compiledFiles = readdirSync(outDir).filter(f => f.endsWith('.inkc'))
        inkManifest.scripts = compiledFiles
        console.log(`Compiled ${compiledFiles.length} script(s)`)
      }
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
