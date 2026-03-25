# Multi-Target Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Quill packages to declare multiple runtime targets (Paper, Hytale, etc.) with per-target runtime folders, and build specific targets on demand.

**Architecture:** Extend `ink-package.toml` schema from a single `runtime` section to a `targets` map. Update `NewCommand` to scaffold per-target folders. Update `InkBuildCommand` to accept `--target` and build only that target. Fail fast if target not declared.

**Tech Stack:** TypeScript, TOML (@iarna/toml), Node.js CLI

---

## File Map

| File | Change |
|------|--------|
| `src/model/manifest.ts` | Replace `RuntimeConfig` with `TargetConfig` map |
| `src/util/toml.ts` | Update read/write for new schema |
| `src/commands/new.ts` | Add `--target` flag, scaffold per-target folders |
| `src/commands/ink-build.ts` | Add `--target` flag, build per-target JAR |
| `src/cli.ts` | Pass `--target` through build command |
| `tests/commands/new.test.ts` | Add tests for multi-target scaffolding |
| `tests/commands/ink-build.test.ts` | Add tests for per-target build |
| `tests/fixtures/multi-target-project/` | New fixture for multi-target testing |

---

## Task 1: Update manifest types

**Files:**
- Modify: `src/model/manifest.ts:1-29`

- [ ] **Step 1: Write the failing test — new TOML round-trips for multi-target**

```typescript
// tests/toml.test.ts (add)
it('round-trips ink-package.toml with multiple targets', () => {
  const manifest: PackageManifest = {
    name: 'ink.mobs',
    version: '0.1.0',
    main: 'mod',
    dependencies: {},
    grammar: { entry: 'src/grammar.ts', output: 'dist/grammar.ir.json' },
    targets: {
      paper: { entry: 'InkMobsPaperRuntime' },
      hytale: { entry: 'InkMobsHytaleRuntime' },
    },
  }
  const toml = TomlParser.write(manifest)
  const parsed = TomlParser.readFromString(toml)
  expect(parsed.targets).toBeDefined()
  expect(parsed.targets!.paper.entry).toBe('InkMobsPaperRuntime')
  expect(parsed.targets!.hytale.entry).toBe('InkMobsHytaleRuntime')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/toml.test.ts -v`
Expected: FAIL — `targets` does not exist on `PackageManifest`

- [ ] **Step 3: Update manifest types**

```typescript
// src/model/manifest.ts
export interface TargetConfig {
  entry: string;
}

export interface GrammarConfig {
  entry: string;
  output: string;
}

export interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  dependencies: Record<string, string>;
  grammar?: GrammarConfig;
  targets: Record<string, TargetConfig>;  // replaces single runtime
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/toml.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/model/manifest.ts
git commit -m "feat: add multi-target manifest types"
```

---

## Task 2: Update TomlParser for multi-target schema

**Files:**
- Modify: `src/util/toml.ts:1-49`

- [ ] **Step 1: Write the failing test**

Add to `tests/toml.test.ts`:

```typescript
it('reads ink-package.toml with targets map', () => {
  const toml = `
[package]
name = "ink.mobs"
version = "0.1.0"

[targets.paper]
entry = "InkMobsPaperRuntime"

[targets.hytale]
entry = "InkMobsHytaleRuntime"

[grammar]
entry = "src/grammar.ts"
output = "dist/grammar.ir.json"
`
  const manifest = TomlParser.readFromString(toml)
  expect(manifest.targets).toBeDefined()
  expect(Object.keys(manifest.targets!)).toEqual(['paper', 'hytale'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/toml.test.ts -v`
Expected: FAIL — `TomlParser.readFromString` doesn't exist, and `targets` not handled

- [ ] **Step 3: Update TomlParser**

```typescript
// src/util/toml.ts
export class TomlParser {
  static read(filePath: string): PackageManifest {
    const content = fs.readFileSync(filePath, 'utf-8');
    return TomlParser.readFromString(content);
  }

  static readFromString(content: string): PackageManifest {
    const data = toml.parse(content);
    const pkg = (data as any).package;
    if (!pkg) throw new Error('ink-package.toml is missing [package] section');
    if (!pkg.name) throw new Error('ink-package.toml is missing package.name');

    // Parse targets section
    const targetsSection = (data as any).targets;
    const targets: Record<string, TargetConfig> = {};
    if (targetsSection) {
      for (const [name, cfg] of Object.entries(targetsSection as Record<string, any>)) {
        targets[name] = { entry: cfg.entry };
      }
    }

    // Legacy single runtime — migrate to targets
    const runtimeSection = (data as any).runtime;
    if (runtimeSection && Object.keys(targets).length === 0) {
      targets['default'] = { entry: runtimeSection.entry };
    }

    const grammarSection = (data as any).grammar;
    return {
      name: pkg.name,
      version: pkg.version ?? '0.0.0',
      description: pkg.description,
      author: pkg.author,
      main: pkg.main ?? pkg.entry ?? 'main',
      dependencies: (data.dependencies as Record<string, string>) ?? {},
      grammar: grammarSection ? {
        entry: grammarSection.entry,
        output: grammarSection.output,
      } : undefined,
      targets,
    };
  }

  static write(manifest: PackageManifest): string {
    const data: Record<string, unknown> = {
      package: {
        name: manifest.name,
        version: manifest.version,
        main: manifest.main,
        ...(manifest.description ? { description: manifest.description } : {}),
        ...(manifest.author ? { author: manifest.author } : {}),
      },
      dependencies: manifest.dependencies,
    };

    if (manifest.grammar) data.grammar = manifest.grammar;

    if (manifest.targets) {
      data.targets = {};
      for (const [name, cfg] of Object.entries(manifest.targets)) {
        (data.targets as Record<string, any>)[name] = { entry: cfg.entry };
      }
    }

    return toml.stringify(data as any);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/toml.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/util/toml.ts tests/toml.test.ts
git commit -m "feat: support multi-target schema in TomlParser"
```

---

## Task 3: Add `--target` flag to NewCommand

**Files:**
- Modify: `src/commands/new.ts:1-119`
- Modify: `src/cli.ts:51-57`

- [ ] **Step 1: Write the failing test**

Add to `tests/commands/new.test.ts`:

```typescript
it('scaffolds multi-target package with --target flag', () => {
  const result = execSync(
    `npx tsx ${CLI} new multi.target --target=paper,hytale`,
    { cwd: FIXTURES, encoding: 'utf8' }
  )

  const pkg = join(FIXTURES, 'multi.target')

  // ink-package.toml has both targets
  const manifest = TomlParser.read(join(pkg, 'ink-package.toml'))
  expect(manifest.targets).toBeDefined()
  expect(Object.keys(manifest.targets!)).toEqual(['paper', 'hytale'])
  expect(manifest.targets!.paper.entry).toBe('MultiTargetPaperRuntime')
  expect(manifest.targets!.hytale.entry).toBe('MultiTargetHytaleRuntime')

  // Per-target runtime folders exist
  expect(existsSync(join(pkg, 'runtime/paper/build.gradle.kts'))).toBe(true)
  expect(existsSync(join(pkg, 'runtime/paper/src/main/kotlin/MultiTargetPaperRuntime.kt'))).toBe(true)
  expect(existsSync(join(pkg, 'runtime/hytale/build.gradle.kts'))).toBe(true)
  expect(existsSync(join(pkg, 'runtime/hytale/src/main/kotlin/MultiTargetHytaleRuntime.kt'))).toBe(true)

  // ops.ink scaffolded in each target
  expect(existsSync(join(pkg, 'runtime/paper/src/main/ink/ops.ink'))).toBe(true)
  expect(existsSync(join(pkg, 'runtime/hytale/src/main/ink/ops.ink'))).toBe(true)

  // No legacy single runtime folder
  expect(existsSync(join(pkg, 'runtime/build.gradle.kts'))).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/commands/new.test.ts -v`
Expected: FAIL — `--target` flag not implemented

- [ ] **Step 3: Update NewCommand to accept `--target`**

```typescript
// src/commands/new.ts — replace the class
export class NewCommand {
  constructor(private projectDir: string) {}

  async run(name: string, targets: string[] = ['default']): Promise<void> {
    const targetDir = path.join(this.projectDir, name);
    if (fs.existsSync(targetDir)) {
      console.error(`Directory already exists: ${name}/`);
      return;
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const className = name
      .split(/[.\-]/)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');

    // Build targets map for manifest
    const targetsMap: Record<string, { entry: string }> = {};
    for (const t of targets) {
      const TargetClassName = `${className}${this.capitalize(t)}Runtime`;
      targetsMap[t] = { entry: `${name}.${TargetClassName}` };
    }

    const manifest: PackageManifest = {
      name,
      version: '0.1.0',
      main: 'mod',
      dependencies: {},
      grammar: {
        entry: 'src/grammar.ts',
        output: 'dist/grammar.ir.json',
      },
      targets: targetsMap,
    };

    fs.writeFileSync(
      path.join(targetDir, 'ink-package.toml'),
      TomlParser.write(manifest)
    );

    // Write shared grammar
    fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'src/grammar.ts'),
      `import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'

export default defineGrammar({
  package: '${name}',
  declarations: [
    declaration({
      keyword: 'mykeyword',
      inheritsBase: true,
      rules: [
        rule('my_rule', r => r.identifier())
      ]
    })
  ]
})
`
    );

    // Write scripts/main.ink
    fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'scripts/main.ink'),
      `// ${name} v0.1.0\n`
    );

    // Write per-target runtime folders
    for (const target of targets) {
      this.writeTargetRuntime(targetDir, name, className, target);
    }

    console.log(`Created package: ${name}/ (targets: ${targets.join(', ')})`);
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private writeTargetRuntime(pkgDir: string, pkgName: string, className: string, target: string): void {
    const targetDir = path.join(pkgDir, 'runtime', target);
    const targetClassName = `${className}${this.capitalize(target)}Runtime`;
    const kotlinEntry = `${pkgName}.${targetClassName}`;

    fs.mkdirSync(path.join(targetDir, 'src/main/kotlin'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'src/main/ink'), { recursive: true });

    // build.gradle.kts
    fs.writeFileSync(
      path.join(targetDir, 'build.gradle.kts'),
      `plugins {
    kotlin("jvm") version "1.9.22"
}

group = "${pkgName}"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.20.4-R0.1-SNAPSHOT")
}

kotlin {
    jvmToolchain(17)
}
`
    );

    // Kotlin VM stub
    fs.writeFileSync(
      path.join(targetDir, `src/main/kotlin/${targetClassName}.kt`),
      `package ${pkgName}

class ${targetClassName} {
    // Implement InkRuntimePackage interface here
}
`
    );

    // ops.ink scaffold
    fs.writeFileSync(
      path.join(targetDir, 'src/main/ink/ops.ink'),
      `// Custom ops for ${target} target
// Define your ops here, they will be transpiled to Kotlin at build time
`
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/commands/new.test.ts -v`
Expected: PASS

- [ ] **Step 5: Update CLI to pass `--target` to NewCommand**

```typescript
// src/cli.ts — update the new command
program.command('new <name>')
  .option('--target <targets>', 'Comma-separated list of targets (e.g. paper,hytale)', 'default')
  .description('Scaffold a new package')
  .action(async (name, options) => {
    const targets = options.target.split(',').map((t: string) => t.trim());
    await new NewCommand(projectDir).run(name, targets);
  });
```

- [ ] **Step 6: Run tests to verify it passes**

Run: `npx vitest tests/commands/new.test.ts -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands/new.ts src/cli.ts
git commit -m "feat: add --target flag to quill new for multi-target scaffolding"
```

---

## Task 4: Add `--target` flag to InkBuildCommand

**Files:**
- Modify: `src/commands/ink-build.ts:1-203`
- Modify: `src/cli.ts:51-57`

- [ ] **Step 1: Write the failing test**

Add to `tests/commands/ink-build.test.ts`:

```typescript
it('build --target=fail fails when target not declared', () => {
  const fixture = join(FIXTURES, 'grammar-project')
  try {
    execSync(
      `npx tsx ${CLI} build --target=paper`,
      { cwd: fixture, encoding: 'utf8', stdio: 'pipe' }
    )
  } catch (e: any) {
    expect(e.stderr.toString()).toContain('target "paper" not declared')
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/commands/ink-build.test.ts -v`
Expected: FAIL — `--target` flag not implemented in InkBuildCommand

- [ ] **Step 3: Update InkBuildCommand to accept target parameter**

```typescript
// src/commands/ink-build.ts
export class InkBuildCommand {
  constructor(private projectDir: string, private target?: string) {}

  async run(): Promise<void> {
    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'));

    // Resolve target
    const targetName = this.target ?? 'default';
    if (!manifest.targets[targetName]) {
      const available = Object.keys(manifest.targets);
      const msg = available.length > 0
        ? `Target "${targetName}" not declared in ink-package.toml. Available: ${available.join(', ')}`
        : `No targets declared in ink-package.toml. Run 'quill new --target=paper,hytale' to scaffold.`;
      console.error(msg);
      process.exit(1);
    }

    const targetConfig = manifest.targets[targetName];
    const distDir = join(this.projectDir, 'dist', targetName);
    mkdirSync(distDir, { recursive: true });

    const inkManifest: Record<string, unknown> = {
      name: manifest.name,
      version: manifest.version,
      target: targetName,
    };

    // Grammar compilation (universal)
    if (manifest.grammar) {
      await this.buildGrammar(manifest.name, manifest.grammar.entry, manifest.grammar.output);
      inkManifest.grammar = 'grammar.ir.json';
    }

    // Per-target runtime build
    const runtimeDir = join(this.projectDir, 'runtime', targetName);
    const gradleFile = join(runtimeDir, 'build.gradle.kts');

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

      console.log(`Running Gradle build in runtime/${targetName}/...`);
      try {
        execSync(`"${gradleCmd}" ${gradleArgs}`, { cwd: runtimeDir, stdio: 'pipe' });
      } catch (e: any) {
        const output = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
        console.error(`Gradle build failed for target "${targetName}":\n` + output);
        process.exit(1);
      }

      // Find output JAR
      const libsDir = join(runtimeDir, 'build/libs');
      const jars = readdirSync(libsDir).filter(f => f.endsWith('.jar'));
      if (jars.length === 0) {
        console.error(`No JAR found in runtime/${targetName}/build/libs/`);
        process.exit(1);
      }

      const jarFilename = jars[0];
      copyFileSync(join(libsDir, jarFilename), join(distDir, jarFilename));
      inkManifest.runtime = {
        jar: jarFilename,
        entry: targetConfig.entry,
        target: targetName,
      };
      console.log(`Runtime jar for "${targetName}" copied to dist/${targetName}/${jarFilename}`);
    }

    // Scripts compilation (unchanged)
    const scriptsDir = join(this.projectDir, 'scripts');
    if (existsSync(scriptsDir)) {
      // ... existing scripts compilation code (same as before)
    }

    // Write ink-manifest.json to dist/<target>/
    writeFileSync(join(distDir, 'ink-manifest.json'), JSON.stringify(inkManifest, null, 2));
    console.log(`Wrote dist/${targetName}/ink-manifest.json`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/commands/ink-build.test.ts -v`
Expected: PASS

- [ ] **Step 5: Update CLI to pass `--target` to InkBuildCommand**

```typescript
// src/cli.ts — update build command
program
  .command('build')
  .option('--target <name>', 'Build for a specific target (e.g. paper, hytale)')
  .description('Compile grammar and/or Ink scripts')
  .action(async (options) => {
    const cmd = new InkBuildCommand(process.cwd(), options.target);
    await cmd.run();
  });
```

- [ ] **Step 6: Run tests to verify it passes**

Run: `npx vitest tests/commands/ink-build.test.ts -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands/ink-build.ts src/cli.ts
git commit -m "feat: add --target flag to quill build for per-target builds"
```

---

## Task 5: Multi-target integration test

**Files:**
- Create: `tests/fixtures/multi-target-project/ink-package.toml`
- Create: `tests/fixtures/multi-target-project/src/grammar.ts`
- Create: `tests/fixtures/multi-target-project/scripts/main.ink`
- Create: `tests/fixtures/multi-target-project/runtime/paper/build.gradle.kts`
- Create: `tests/fixtures/multi-target-project/runtime/paper/src/main/kotlin/MultiTargetPaperRuntime.kt`
- Create: `tests/fixtures/multi-target-project/runtime/paper/src/main/ink/ops.ink`
- Create: `tests/fixtures/multi-target-project/runtime/hytale/build.gradle.kts`
- Create: `tests/fixtures/multi-target-project/runtime/hytale/src/main/kotlin/MultiTargetHytaleRuntime.kt`
- Create: `tests/fixtures/multi-target-project/runtime/hytale/src/main/ink/ops.ink`

- [ ] **Step 1: Create fixture structure** (create all files above — omit generated content as it's scaffolded by quill new)

- [ ] **Step 2: Write integration test**

Add to `tests/commands/ink-build.test.ts`:

```typescript
it('build --target=paper only builds paper runtime', () => {
  const fixture = join(FIXTURES, 'multi-target-project')
  // Clean dist
  try { rmSync(join(fixture, 'dist'), { recursive: true }) } catch {}

  execSync(`npx tsx ${CLI} build --target=paper`, { cwd: fixture, encoding: 'utf8' })

  // dist/paper/ exists, dist/hytale/ does not
  expect(existsSync(join(fixture, 'dist/paper/ink-manifest.json'))).toBe(true)
  expect(existsSync(join(fixture, 'dist/paper/grammar.ir.json'))).toBe(true)
  expect(existsSync(join(fixture, 'dist/hytale'))).toBe(false)
})
```

- [ ] **Step 3: Run test**

Run: `npx vitest tests/commands/ink-build.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/multi-target-project/ tests/commands/ink-build.test.ts
git commit -m "test: add multi-target fixture and integration test"
```

---

## Task 6: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `npx vitest`
Expected: ALL PASS

- [ ] **Step 2: Commit final state**

```bash
git add -A
git commit -m "feat: multi-target runtime support in quill

- Add --target flag to quill new for multi-target scaffolding
- Add --target flag to quill build for per-target builds
- ink-package.toml uses targets map instead of single runtime
- TomlParser supports both legacy and new schema
- Build fails fast if target not declared
- ops.ink scaffolded per target for custom op injection

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

- [ ] Spec coverage: All design requirements implemented?
  - ✅ `--target` flag on `NewCommand`
  - ✅ Multi-target `ink-package.toml` schema
  - ✅ Per-target runtime folder scaffolding
  - ✅ `--target` flag on `BuildCommand`
  - ✅ Per-target JAR build
  - ✅ Fail if target not declared
  - ✅ `ops.ink` scaffold per target
- [ ] Placeholder scan: No TBD/TODO steps
- [ ] Type consistency: `manifest.targets` used consistently throughout
- [ ] All existing tests still pass (run `npx vitest` to verify)
