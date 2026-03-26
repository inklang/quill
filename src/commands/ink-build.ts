// src/commands/ink-build.ts
import { TomlParser } from '../util/toml.js'
import { AuthoredGrammar } from '../grammar/api.js'
import { serialize } from '../grammar/serializer.js'
import { validate } from '../grammar/validator.js'
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, existsSync, copyFileSync, readdirSync } from 'fs'
import { join, dirname, basename, sep } from 'path'
import { execSync, spawnSync } from 'child_process'
import { CacheManifestStore } from '../cache/manifest.js'
import { hashFile, hashGrammarIr, findDirtyFiles, DirtyFile } from '../cache/util.js'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

export class InkBuildCommand {
  constructor(private projectDir: string, private target?: string) {}

  async run(opts: { full?: boolean } = {}): Promise<void> {
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
    } else if (manifest.target) {
      inkManifest.target = manifest.target;
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
        entry: targetConfig?.entry ?? manifest.runtime?.entry,
        target: targetName,
      };
      const distRel = distDir.endsWith(`dist${sep}${targetName}`) ? `dist/${targetName}/` : 'dist/';
      console.log(`Runtime jar copied to ${distRel}${jarFilename}`);
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
      console.log(`Runtime jar copied to ${distRel}${jarFilename}`);
    }

    // Copy artifacts from installed packages matching project target
    if (targetConfig || manifest.target) {
      this.copyPackageArtifacts(targetName, distDir);
    }

    // Scripts compilation with incremental build support
    const scriptsDir = join(this.projectDir, 'scripts');
    if (existsSync(scriptsDir)) {
      const inkFiles = readdirSync(scriptsDir).filter(f => f.endsWith('.ink'));
      if (inkFiles.length > 0) {
        const compiler = process.env['INK_COMPILER'] || '';
        if (!compiler) {
          console.error('Ink compiler not found. Set INK_COMPILER or [build] compiler in ink-package.toml.');
          process.exit(1);
        }

        const outDir = join(distDir, 'scripts');
        mkdirSync(outDir, { recursive: true });

        if (opts.full) {
          // Full rebuild: batch mode + fresh manifest
          this.compileScriptsBatch(compiler, scriptsDir, outDir, distDir);
          const grammarHash = hashGrammarIr(distDir);
          const dirtyFiles: DirtyFile[] = inkFiles.map(f => ({
            relativePath: `scripts/${f}`.replace(/\\/g, '/'),
            hash: hashFile(join(scriptsDir, f)),
          }));
          const entries: Record<string, any> = {};
          for (const f of dirtyFiles) {
            const output = f.relativePath.replace(/\.ink$/, '.inkc');
            entries[f.relativePath] = {
              hash: f.hash,
              output,
              compiledAt: new Date().toISOString(),
            };
          }
          const cacheManifest = {
            version: 1 as const,
            lastFullBuild: new Date().toISOString(),
            grammarIrHash: grammarHash,
            entries,
          };
          const cacheStore = new CacheManifestStore(join(this.projectDir, '.quill', 'cache'));
          cacheStore.write(cacheManifest);
        } else {
          // Incremental build
          const cacheStore = new CacheManifestStore(join(this.projectDir, '.quill', 'cache'));
          const cachedManifest = cacheStore.read();

          // Grammar IR change invalidates all scripts
          const currentGrammarHash = hashGrammarIr(distDir);
          const grammarChanged = cachedManifest && cachedManifest.grammarIrHash !== currentGrammarHash;

          if (grammarChanged) {
            console.log('Grammar IR changed — invalidating script cache');
          }

          const dirtyFiles = grammarChanged
            ? inkFiles.map(f => ({
                relativePath: `scripts/${f}`.replace(/\\/g, '/'),
                hash: hashFile(join(scriptsDir, f)),
              }))
            : findDirtyFiles(this.projectDir, scriptsDir, cachedManifest);

          if (dirtyFiles.length === 0) {
            console.log('All scripts up to date — skipping compilation');
          } else {
            // Single-file mode per dirty file
            const compiledCount = this.compileScriptsIncremental(compiler, dirtyFiles, scriptsDir, outDir);
            console.log(`Compiled ${compiledCount} script(s)`);

            // Merge new entries into manifest
            const allEntries = { ...(cachedManifest?.entries ?? {}) };
            for (const f of dirtyFiles) {
              const output = f.relativePath.replace(/\.ink$/, '.inkc');
              allEntries[f.relativePath] = {
                hash: f.hash,
                output,
                compiledAt: new Date().toISOString(),
              };
            }
            // Remove entries for deleted source files
            for (const relPath of Object.keys(allEntries)) {
              const fullPath = join(this.projectDir, relPath);
              if (!existsSync(fullPath)) {
                delete allEntries[relPath];
              }
            }
            const newManifest = {
              version: 1 as const,
              lastFullBuild: cachedManifest?.lastFullBuild ?? new Date().toISOString(),
              grammarIrHash: currentGrammarHash,
              entries: allEntries,
            };
            cacheStore.write(newManifest);
          }
        }
        const compiledFiles = readdirSync(outDir).filter(f => f.endsWith('.inkc'));
        inkManifest.scripts = compiledFiles;
      }
    }

    writeFileSync(join(distDir, 'ink-manifest.json'), JSON.stringify(inkManifest, null, 2));
    const manifestRel = distDir.endsWith(`dist${sep}${targetName}`) ? `dist/${targetName}/` : 'dist/';
    console.log(`Wrote ${manifestRel}ink-manifest.json`);
  }

  /**
   * Copy runtime artifacts from installed packages matching the project target
   * into the project's dist/ directory.
   */
  private copyPackageArtifacts(target: string, distDir: string): void {
    const packagesDir = join(this.projectDir, 'packages');
    if (!existsSync(packagesDir)) return;

    for (const pkgName of readdirSync(packagesDir)) {
      const pkgTargetDir = join(packagesDir, pkgName, target);
      const manifestPath = join(pkgTargetDir, 'ink-manifest.json');

      if (!existsSync(manifestPath)) {
        console.error(`Error: Package ${pkgName} has no variant for target "${target}".`);
        process.exit(1);
      }

      let pkgManifest: any;
      try {
        pkgManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        console.error(`Error: Invalid ink-manifest.json in package ${pkgName}`);
        process.exit(1);
      }

      if (pkgManifest.target !== target) {
        console.error(`Error: Package ${pkgName} is installed for target "${pkgManifest.target}" but project targets "${target}".`);
        console.error(`       Run quill reinstall to resolve.`);
        process.exit(1);
      }

      // Copy runtime JAR if present
      if (pkgManifest.runtime?.jar) {
        const srcJar = join(pkgTargetDir, pkgManifest.runtime.jar);
        if (existsSync(srcJar)) {
          copyFileSync(srcJar, join(distDir, pkgManifest.runtime.jar));
        }
      }
    }
  }

  private async buildGrammar(packageName: string, grammarEntry: string, grammarOutput: string): Promise<void> {
    const entryPath = join(this.projectDir, grammarEntry);
    const outputPath = join(this.projectDir, grammarOutput);

    const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const wrapperPath = join(tmpdir(), `ink-grammar-wrapper-${uid}.mjs`);
    const grammarOutputPath = join(tmpdir(), `ink-grammar-output-${uid}.json`);

    const entryUrl = pathToFileURL(entryPath).href;
    writeFileSync(wrapperPath, `
import { writeFileSync } from 'fs';
const m = await import('${entryUrl}');
const result = JSON.stringify(m.default);
writeFileSync('${grammarOutputPath.replace(/\\/g, '\\\\')}', result);
`.trim());

    try {
      execSync(`npx tsx ${wrapperPath}`, { cwd: this.projectDir, stdio: 'pipe' });
    } catch (e) {
      console.error(`Failed to load grammar file: ${entryPath}`);
      process.exit(1);
    } finally {
      try { unlinkSync(wrapperPath); } catch {}
    }

    let defaultExport: AuthoredGrammar;
    try {
      const content = readFileSync(grammarOutputPath, 'utf8');
      defaultExport = JSON.parse(content);
    } catch {
      console.error('Grammar file did not export valid JSON via default');
      process.exit(1);
    } finally {
      try { unlinkSync(grammarOutputPath); } catch {}
    }

    if (defaultExport.package !== packageName) {
      console.error(`Package name mismatch: ink-package.toml says '${packageName}' but grammar.ts exports '${defaultExport.package}'`);
      process.exit(1);
    }

    const errors = validate(defaultExport);
    if (errors.length > 0) {
      console.error('Grammar validation errors:');
      for (const err of errors) {
        console.error(`  [${err.type}] ${err.ruleName}: ${err.detail}`);
      }
      process.exit(1);
    }

    const ir = serialize(defaultExport);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(ir, null, 2));
    console.log(`Grammar IR written to ${outputPath}`);
  }

  private compileScriptsBatch(
    compiler: string,
    scriptsDir: string,
    outDir: string,
    distDir: string
  ): void {
    const isPrintingPress = compiler.endsWith('printing_press') || compiler.endsWith('printing_press.exe');
    const compilerPath = compiler.replace(/\\/g, '/');
    const scriptsDirFwd = scriptsDir.replace(/\\/g, '/');
    const outDirFwd = outDir.replace(/\\/g, '/');

    if (isPrintingPress) {
      try {
        execSync(
          `"${compilerPath}" compile --sources "${scriptsDirFwd}" --out "${outDirFwd}"`,
          { cwd: this.projectDir, stdio: 'pipe' } as any
        );
      } catch (e: any) {
        const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
        console.error('Ink compilation failed:\n' + output);
        process.exit(1);
      }
    } else {
      const javaCmd = (process.env['INK_JAVA'] || 'java').replace(/\\/g, '/');
      const inkManifestPath = join(distDir, 'ink-manifest.json');
      const grammarFlags = existsSync(inkManifestPath)
        ? `--grammar "${join(distDir, JSON.parse(readFileSync(inkManifestPath, 'utf8')).grammar as string).replace(/\\/g, '/')}" `
        : '';

      try {
        execSync(
          `"${javaCmd}" -jar "${compilerPath}" compile ${grammarFlags}--sources "${scriptsDirFwd}" --out "${outDirFwd}"`,
          { cwd: this.projectDir, stdio: 'pipe' } as any
        );
      } catch (e: any) {
        const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
        console.error('Ink compilation failed:\n' + output);
        process.exit(1);
      }
    }
  }

  private compileScriptsIncremental(
    compiler: string,
    dirtyFiles: DirtyFile[],
    scriptsDir: string,
    outDir: string
  ): number {
    const isPrintingPress = compiler.endsWith('printing_press') || compiler.endsWith('printing_press.exe');
    const compilerPath = compiler.replace(/\\/g, '/');
    let compiled = 0;

    for (const dirty of dirtyFiles) {
      const inputPath = join(this.projectDir, dirty.relativePath);
      const outputPath = join(outDir, dirty.relativePath.replace(/^scripts\//, '').replace(/\.ink$/, '.inkc'));

      // Ensure output subdirectory exists
      mkdirSync(dirname(outputPath), { recursive: true });

      const inputFwd = inputPath.replace(/\\/g, '/');
      const outputFwd = outputPath.replace(/\\/g, '/');

      let ok = false;
      let result: ReturnType<typeof spawnSync> | null = null;
      if (isPrintingPress) {
        result = spawnSync(`"${compilerPath}" compile "${inputFwd}" -o "${outputFwd}"`, {
          shell: true,
          cwd: this.projectDir,
        });
        if (result.error) {
          console.error(`Compiler error: ${result.error.message}`);
          ok = false;
        } else {
          ok = result.status === 0;
        }
      } else {
        const javaCmd = (process.env['INK_JAVA'] || 'java').replace(/\\/g, '/');
        result = spawnSync(
          `"${javaCmd}" -jar "${compilerPath}" compile "${inputFwd}" -o "${outputFwd}"`,
          { shell: true, cwd: this.projectDir }
        );
        if (result.error) {
          console.error(`Compiler error: ${result.error.message}`);
          ok = false;
        } else {
          ok = result.status === 0;
        }
      }

      if (!ok) {
        console.error(`Failed to compile ${dirty.relativePath}`);
        if (result.stdout) console.error(result.stdout.toString());
        if (result.stderr) console.error(result.stderr.toString());
        process.exit(1);
      }
      compiled++;
    }

    return compiled;
  }
}
