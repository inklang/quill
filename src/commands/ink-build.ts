// src/commands/ink-build.ts
import { TomlParser } from '../util/toml.js'
import { AuthoredGrammar } from '../grammar/api.js'
import { serialize } from '../grammar/serializer.js'
import { validate } from '../grammar/validator.js'
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, existsSync, copyFileSync, readdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { pathToFileURL, fileURLToPath } from 'url'
import { resolveCompiler } from '../util/compiler.js'

export class InkBuildCommand {
  constructor(private projectDir: string) {}

  async run(opts: { full?: boolean } = {}): Promise<void> {
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
        let compiler: string | null
        try {
          compiler = await resolveCompiler()
        } catch (e: any) {
          throw new Error(
            'Ink compiler not found.\n' +
            '\n' +
            'Options:\n' +
            '  1. Download it automatically:\n' +
            '       quill build  (compiler will be downloaded on first run)\n' +
            '\n' +
            '  2. Set INK_COMPILER environment variable to an existing compiler:\n' +
            `       Windows (cmd):  set INK_COMPILER=C:\\path\\to\\printing_press.exe\n` +
            `       Windows (ps):  $env:INK_COMPILER=\"C:\\path\\to\\printing_press.exe\"\n` +
            `       macOS/Linux:   export INK_COMPILER=/path/to/printing_press\n` +
            '\n' +
            '  3. Build from source: https://github.com/inklang/printing_press\n' +
            '\n' +
            `Error: ${e.message}`
          )
        }

        const isPrintingPress = compiler!.endsWith('printing_press') || compiler!.endsWith('printing_press.exe')
        const outDir = join(distDir, 'scripts')
        mkdirSync(outDir, { recursive: true })

        const compilerPath = compiler!.replace(/\\/g, '/')
        const scriptsDirFwd = scriptsDir.replace(/\\/g, '/')
        const outDirFwd = outDir.replace(/\\/g, '/')

        if (isPrintingPress) {
          // printing_press batch mode (grammars auto-discovered)
          try {
            execSync(
              `"${compilerPath}" compile --sources "${scriptsDirFwd}" --out "${outDirFwd}"`,
              { cwd: this.projectDir, stdio: 'pipe' } as any
            )
          } catch (e: any) {
            const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')
            console.error('Ink compilation failed:\n' + output)
            process.exit(1)
          }
        } else {
          // ink.jar batch mode (uses --grammar flags)
          const javaCmd = (process.env['INK_JAVA'] || 'java').replace(/\\/g, '/')
          const grammarFlags = inkManifest.grammar
            ? `--grammar "${join(distDir, inkManifest.grammar as string).replace(/\\/g, '/')}" `
            : ''

          try {
            execSync(
              `"${javaCmd}" -jar "${compilerPath}" compile ${grammarFlags}--sources "${scriptsDirFwd}" --out "${outDirFwd}"`,
              { cwd: this.projectDir, stdio: 'pipe' } as any
            )
          } catch (e: any) {
            const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')
            console.error('Ink compilation failed:\n' + output)
            process.exit(1)
          }
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

    const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const wrapperPath = join(tmpdir(), `ink-grammar-wrapper-${uid}.mjs`)
    const grammarOutputPath = join(tmpdir(), `ink-grammar-output-${uid}.json`)
    const tsconfigPath = join(tmpdir(), `ink-grammar-tsconfig-${uid}.json`)

    const quillGrammarApi = join(fileURLToPath(new URL('../..', import.meta.url)), 'src/grammar/api.ts')
    writeFileSync(tsconfigPath, JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        paths: { '@inklang/quill/grammar': [quillGrammarApi] }
      }
    }))

    const entryUrl = pathToFileURL(entryPath).href
    writeFileSync(wrapperPath, `
import { writeFileSync } from 'fs';
const m = await import('${entryUrl}');
const result = JSON.stringify(m.default);
writeFileSync('${grammarOutputPath.replace(/\\/g, '\\\\')}', result);
`.trim())

    try {
      execSync(`npx tsx --tsconfig "${tsconfigPath}" ${wrapperPath}`, {
        cwd: this.projectDir,
        stdio: 'pipe',
      })
    } catch (e) {
      console.error(`Failed to load grammar file: ${entryPath}`)
      process.exit(1)
    } finally {
      try { unlinkSync(wrapperPath) } catch {}
      try { unlinkSync(tsconfigPath) } catch {}
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
