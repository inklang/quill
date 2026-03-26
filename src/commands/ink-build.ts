// src/commands/ink-build.ts
import { TomlParser } from '../util/toml.js'
import { AuthoredGrammar } from '../grammar/api.js'
import { serialize } from '../grammar/serializer.js'
import { validate } from '../grammar/validator.js'
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, existsSync, copyFileSync, readdirSync } from 'fs'
import { join, dirname, basename, sep } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

export class InkBuildCommand {
  constructor(private projectDir: string, private target?: string) {}

  async run(): Promise<void> {
    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'))

    // Resolve target
    const targetName = this.target ?? 'default';
    const targets = manifest.targets ?? {};

    // Validate: if a specific target was requested, it must be declared
    if (this.target !== undefined && !targets[targetName]) {
      const available = Object.keys(targets);
      const msg = available.length > 0
        ? `Target "${targetName}" not declared in ink-package.toml. Available: ${available.join(', ')}`
        : `No targets declared in ink-package.toml. Run 'quill new --target=paper,hytale' to scaffold.`;
      console.error(msg);
      process.exit(1);
    }

    const targetConfig = targets[targetName];

    // Determine dist directory and whether to include target in output paths
    // For legacy projects (runtime at root, not runtime/<target>/), use dist/ root
    const legacyRuntimeDir = join(this.projectDir, 'runtime');
    const legacyGradleFile = join(legacyRuntimeDir, 'build.gradle.kts');
    const hasLegacyRuntime = existsSync(legacyGradleFile);
    const hasExternalJar = targetConfig?.jar && !hasLegacyRuntime;
    // Legacy = default target + (has legacy gradle OR external JAR) + no new-structure gradle
    const isLegacyDefault = targetName === 'default' && (hasLegacyRuntime || hasExternalJar) && !existsSync(join(this.projectDir, 'runtime', targetName, 'build.gradle.kts'));

    const distDir = (targetConfig && !isLegacyDefault)
      ? join(this.projectDir, 'dist', targetName)
      : join(this.projectDir, 'dist');
    mkdirSync(distDir, { recursive: true });

    const inkManifest: Record<string, unknown> = {
      name: manifest.name,
      version: manifest.version,
    };
    if (targetConfig) {
      inkManifest.target = targetName;
    }

    // Grammar compilation (universal)
    if (manifest.grammar) {
      await this.buildGrammar(manifest.name, manifest.grammar.entry, manifest.grammar.output);
      inkManifest.grammar = 'grammar.ir.json';
    }

    // Per-target runtime build
    // Check for new per-target structure first, fall back to legacy runtime/ root
    let runtimeDir = join(this.projectDir, 'runtime', targetName);
    let gradleFile = join(runtimeDir, 'build.gradle.kts');

    if (!existsSync(gradleFile) && existsSync(legacyGradleFile)) {
      // Backwards compatibility: use legacy runtime/ folder structure
      runtimeDir = legacyRuntimeDir;
      gradleFile = legacyGradleFile;
    }

    if (existsSync(gradleFile)) {
      let gradleCmd = 'gradle';
      const isWindows = process.platform === 'win32';
      const wrapperBat = join(runtimeDir, 'gradlew.bat');
      const wrapperSh = join(runtimeDir, 'gradlew');

      let gradleArgs = 'build';
      if (isWindows && existsSync(wrapperBat)) {
        gradleCmd = wrapperBat;
      } else if (existsSync(wrapperSh)) {
        gradleCmd = isWindows ? 'bash' : wrapperSh;
        gradleArgs = isWindows ? `"${wrapperSh.replace(/\\/g, '/')}" build` : 'build';
      }

      const runtimeDisplay = runtimeDir === legacyRuntimeDir ? 'runtime/' : `runtime/${targetName}/`;
      console.log(`Running Gradle build in ${runtimeDisplay}...`);
      try {
        execSync(`"${gradleCmd}" ${gradleArgs}`, { cwd: runtimeDir, stdio: 'pipe' });
      } catch (e: any) {
        const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
        console.error(`Gradle build failed:\n` + output);
        process.exit(1);
      }
      console.log('Gradle build successful');

      const libsDir = join(runtimeDir, 'build/libs');
      const jars = readdirSync(libsDir).filter(f => f.endsWith('.jar'));
      if (jars.length === 0) {
        console.error(`No JAR found in ${runtimeDisplay}build/libs/`);
        process.exit(1);
      }

      const jarFilename = jars[0];
      copyFileSync(join(libsDir, jarFilename), join(distDir, jarFilename));
      inkManifest.runtime = {
        jar: jarFilename,
        entry: targetConfig.entry,
        target: targetName,
      };
      // Compute relative path: dist/ or dist/<target>/
      const distRel = distDir.endsWith(`dist${sep}${targetName}`) ? `dist/${targetName}/` : 'dist/';
      const jarDest = `${distRel}${jarFilename}`;
      console.log(`Runtime jar copied to ${jarDest}`);
    } else if (targetConfig?.jar) {
      // External JAR path — copy directly
      const jarSource = join(this.projectDir, targetConfig.jar);
      if (!existsSync(jarSource)) {
        console.error(`Runtime jar not found: ${targetConfig.jar} — build it with Gradle first`);
        process.exit(1);
      }
      const jarFilename = basename(targetConfig.jar);
      copyFileSync(jarSource, join(distDir, jarFilename));
      inkManifest.runtime = {
        jar: jarFilename,
        entry: targetConfig.entry,
        target: targetName,
      };
      const distRel = distDir.endsWith(`dist${sep}${targetName}`) ? `dist/${targetName}/` : 'dist/';
      const jarDest = `${distRel}${jarFilename}`;
      console.log(`Runtime jar copied to ${jarDest}`);
    }

    // Scripts compilation
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
            { cwd: this.projectDir, stdio: 'pipe' }
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

    writeFileSync(join(distDir, 'ink-manifest.json'), JSON.stringify(inkManifest, null, 2));
    const manifestRel = distDir.endsWith(`dist${sep}${targetName}`) ? `dist/${targetName}/` : 'dist/';
    console.log(`Wrote ${manifestRel}ink-manifest.json`);
  }

  private async buildGrammar(packageName: string, grammarEntry: string, grammarOutput: string): Promise<void> {
    const entryPath = join(this.projectDir, grammarEntry)
    const outputPath = join(this.projectDir, grammarOutput)

    const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const wrapperPath = join(tmpdir(), `ink-grammar-wrapper-${uid}.mjs`)
    const grammarOutputPath = join(tmpdir(), `ink-grammar-output-${uid}.json`)

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
