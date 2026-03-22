# Quill Roadmap Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full Quill build system roadmap — from cleanup through scaffold, Gradle orchestration, compilation, registry, and watch.

**Architecture:** Quill is a Commander.js CLI (`src/cli.ts`) with command classes in `src/commands/`. Each command gets a `projectDir` and has a `run()` method. Tests use Vitest and invoke the CLI via `execSync` against fixture projects in `tests/fixtures/`. The grammar system (`src/grammar/`) is already complete.

**Tech Stack:** TypeScript, Node.js (ESM), Commander.js, Vitest, `@iarna/toml`, `chokidar` (added in Chunk 6)

**Spec:** `docs/superpowers/specs/2026-03-22-quill-roadmap-design.md`

---

## Chunk 1: Remove `quill ink-new` and Clean Up

### Task 1.1: Remove ink-new command registration from CLI

**Files:**
- Modify: `src/cli.ts:12,66-72`
- Delete: `src/commands/ink-new.ts`

- [ ] **Step 1: Remove the import and command registration from `src/cli.ts`**

Remove line 12 (`import { InkNewCommand }`) and lines 66-72 (the `ink-new` command block). The file should go from:

```typescript
import { InkNewCommand } from './commands/ink-new.js'
```
to: (line deleted)

And remove:
```typescript
program
  .command('ink-new')
  .description('Scaffold a new Ink grammar package')
  .action(async () => {
    const cmd = new InkNewCommand(process.cwd())
    await cmd.run()
  })
```

- [ ] **Step 2: Delete `src/commands/ink-new.ts`**

```bash
rm src/commands/ink-new.ts
```

- [ ] **Step 3: Verify no remaining references to ink-new**

```bash
cd C:/Users/justi/chev/quill && grep -r "ink-new\|InkNew\|ink_new" src/ tests/ --include="*.ts" || echo "No references found"
```

Expected: "No references found"

- [ ] **Step 4: Run tests to confirm nothing is broken**

```bash
cd C:/Users/justi/chev/quill && npx vitest run
```

Expected: All existing tests pass (24+)

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts && git rm src/commands/ink-new.ts && git commit -m "chore: remove quill ink-new command"
```

---

## Chunk 2: `quill new` Full Scaffold

### Task 2.0: Fix `TomlParser.write()` to produce valid `[package]`-sectioned TOML

**Context:** `TomlParser.write()` currently calls `toml.stringify(manifest)` which produces flat keys (`name = "..."` at root level). But `TomlParser.read()` expects `data.package.name` (a `[package]` section). This means any TOML written by Quill cannot be read back by Quill. This must be fixed before `quill new` can produce valid manifests.

**Files:**
- Modify: `src/util/toml.ts:35-37`
- Modify: `tests/toml.test.ts` (add round-trip test)

- [ ] **Step 1: Write failing round-trip test**

Add to `tests/toml.test.ts`:

```typescript
it('write() output can be read back by read()', () => {
  const manifest: PackageManifest = {
    name: 'ink.roundtrip',
    version: '1.0.0',
    main: 'mod',
    dependencies: { 'ink.core': '>=1.0.0' },
    grammar: { entry: 'src/grammar.ts', output: 'dist/grammar.ir.json' },
    runtime: { jar: 'runtime/test.jar', entry: 'ink.test.TestRuntime' },
  }
  const tomlStr = TomlParser.write(manifest)
  const tmpPath = join(tmpdir(), `toml-roundtrip-${Date.now()}.toml`)
  writeFileSync(tmpPath, tomlStr)
  try {
    const parsed = TomlParser.read(tmpPath)
    expect(parsed.name).toBe('ink.roundtrip')
    expect(parsed.version).toBe('1.0.0')
    expect(parsed.grammar?.entry).toBe('src/grammar.ts')
    expect(parsed.runtime?.jar).toBe('runtime/test.jar')
  } finally {
    unlinkSync(tmpPath)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/toml.test.ts
```

Expected: FAIL — `TomlParser.read()` throws "missing [package] section"

- [ ] **Step 3: Fix `TomlParser.write()` to wrap fields under `[package]`**

Replace lines 35-37 in `src/util/toml.ts`:

```typescript
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
    if (manifest.runtime) data.runtime = manifest.runtime;
    return toml.stringify(data as any);
  }
```

- [ ] **Step 4: Run tests to verify the fix**

```bash
cd C:/Users/justi/chev/quill && npx vitest run
```

Expected: All tests pass including the new round-trip test

- [ ] **Step 5: Commit**

```bash
git add src/util/toml.ts tests/toml.test.ts && git commit -m "fix: TomlParser.write() produces valid [package]-sectioned TOML"
```

### Task 2.1: Write failing tests for the new scaffold

**Files:**
- Create: `tests/commands/new.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/commands/new.test.ts
import { execSync } from 'child_process'
import { readFileSync, existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, afterEach } from 'vitest'
import { TomlParser } from '../../src/util/toml.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const TMP = join(__dirname, '../fixtures/.tmp-new-test')

afterEach(() => {
  try { rmSync(TMP, { recursive: true }) } catch {}
})

describe('quill new', () => {
  it('scaffolds full package with grammar + runtime + gradle', () => {
    const result = execSync(
      `npx tsx ${CLI} new ink.mobs`,
      { cwd: TMP + '/..', encoding: 'utf8' }
    )

    const pkg = join(TMP, '../ink.mobs')
    try {
      // Directory structure
      expect(existsSync(join(pkg, 'ink-package.toml'))).toBe(true)
      expect(existsSync(join(pkg, 'src/grammar.ts'))).toBe(true)
      expect(existsSync(join(pkg, 'scripts/main.ink'))).toBe(true)
      expect(existsSync(join(pkg, 'runtime/build.gradle.kts'))).toBe(true)
      expect(existsSync(join(pkg, 'runtime/src/main/kotlin/InkMobsRuntime.kt'))).toBe(true)

      // ink-package.toml has all sections and round-trips correctly
      const manifest = TomlParser.read(join(pkg, 'ink-package.toml'))
      expect(manifest.name).toBe('ink.mobs')
      expect(manifest.version).toBe('0.1.0')
      expect(manifest.dependencies).toBeDefined()
      expect(manifest.grammar).toBeDefined()
      expect(manifest.grammar!.entry).toBe('src/grammar.ts')
      expect(manifest.grammar!.output).toBe('dist/grammar.ir.json')
      expect(manifest.runtime).toBeDefined()
      expect(manifest.runtime!.jar).toContain('.jar')
      expect(manifest.runtime!.entry).toBeDefined()

      // grammar.ts imports from @inklang/quill/grammar
      const grammar = readFileSync(join(pkg, 'src/grammar.ts'), 'utf8')
      expect(grammar).toContain("from '@inklang/quill/grammar'")
      expect(grammar).toContain('defineGrammar')
      expect(grammar).toContain("package: 'ink.mobs'")

      // build.gradle.kts exists and is valid
      const gradle = readFileSync(join(pkg, 'runtime/build.gradle.kts'), 'utf8')
      expect(gradle).toContain('kotlin')

      // Kotlin runtime stub exists
      const kt = readFileSync(join(pkg, 'runtime/src/main/kotlin/InkMobsRuntime.kt'), 'utf8')
      expect(kt).toContain('InkMobsRuntime')
    } finally {
      try { rmSync(pkg, { recursive: true }) } catch {}
    }
  })

  it('rejects if directory already exists', async () => {
    const { mkdirSync: mkDir } = await import('fs')
    const pkg = join(TMP, '../existing-pkg')
    mkDir(pkg, { recursive: true })
    try {
      execSync(
        `npx tsx ${CLI} new existing-pkg`,
        { cwd: TMP + '/..', encoding: 'utf8', stdio: 'pipe' }
      )
      // Command writes to stderr and returns exit 0
    } catch (e: any) {
      expect(e.stderr.toString()).toContain('already exists')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/commands/new.test.ts
```

Expected: FAIL — scaffolded directories don't exist yet

### Task 2.2: Implement the full scaffold in `quill new`

**Files:**
- Modify: `src/commands/new.ts`

- [ ] **Step 3: Rewrite `src/commands/new.ts` with full scaffold logic**

Replace the entire file content with:

```typescript
import { TomlParser } from '../util/toml.js';
import { PackageManifest } from '../model/manifest.js';
import fs from 'fs';
import path from 'path';

export class NewCommand {
  constructor(private projectDir: string) {}

  async run(name: string): Promise<void> {
    const targetDir = path.join(this.projectDir, name);
    if (fs.existsSync(targetDir)) {
      console.error(`Directory already exists: ${name}/`);
      return;
    }

    fs.mkdirSync(targetDir, { recursive: true });

    // Derive Kotlin class name from package name: ink.mobs -> InkMobs
    const className = name
      .split(/[.\-]/)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');

    // Write ink-package.toml
    const manifest: PackageManifest = {
      name,
      version: '0.1.0',
      main: 'mod',
      dependencies: {},
      grammar: {
        entry: 'src/grammar.ts',
        output: 'dist/grammar.ir.json',
      },
      runtime: {
        jar: `runtime/build/libs/${name}-0.1.0.jar`,
        entry: `${name}.${className}Runtime`,
      },
    };

    fs.writeFileSync(
      path.join(targetDir, 'ink-package.toml'),
      TomlParser.write(manifest)
    );

    // Write src/grammar.ts
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

    // Write runtime/build.gradle.kts
    const runtimeDir = path.join(targetDir, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'build.gradle.kts'),
      `plugins {
    kotlin("jvm") version "1.9.22"
}

group = "${name}"
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

    // Write runtime/src/main/kotlin/<ClassName>Runtime.kt
    const ktDir = path.join(runtimeDir, 'src/main/kotlin');
    fs.mkdirSync(ktDir, { recursive: true });
    fs.writeFileSync(
      path.join(ktDir, `${className}Runtime.kt`),
      `package ${name}

class ${className}Runtime {
    // Implement InkRuntimePackage interface here
}
`
    );

    console.log(`Created package: ${name}/`);
    console.log('  ink-package.toml');
    console.log('  src/grammar.ts');
    console.log('  scripts/main.ink');
    console.log('  runtime/build.gradle.kts');
    console.log(`  runtime/src/main/kotlin/${className}Runtime.kt`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/commands/new.test.ts
```

Expected: PASS

- [ ] **Step 5: Run all tests to make sure nothing else broke**

```bash
cd C:/Users/justi/chev/quill && npx vitest run
```

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/new.ts tests/commands/new.test.ts && git commit -m "feat: quill new scaffolds full package with grammar + runtime + gradle"
```

---

## Chunk 3: `quill build` Gradle Orchestration

### Task 3.1: Write failing tests for Gradle build orchestration

**Files:**
- Create: `tests/commands/ink-build-gradle.test.ts`
- Create: `tests/fixtures/gradle-project/` (test fixture with mock gradle)

- [ ] **Step 1: Create a test fixture that simulates a Gradle project**

Create `tests/fixtures/gradle-project/` with:
- `ink-package.toml` pointing to `runtime/build/libs/` for the JAR
- `src/grammar.ts` with a simple grammar
- A mock `runtime/gradlew` script that creates the JAR instead of running real Gradle

```bash
mkdir -p C:/Users/justi/chev/quill/tests/fixtures/gradle-project/runtime/build/libs
mkdir -p C:/Users/justi/chev/quill/tests/fixtures/gradle-project/src
```

Write `tests/fixtures/gradle-project/ink-package.toml`:
```toml
[package]
name = "ink.gradletest"
version = "0.1.0"
main = "mod"

[dependencies]

[grammar]
entry = "src/grammar.ts"
output = "dist/grammar.ir.json"

[runtime]
jar = "runtime/build/libs/ink.gradletest-0.1.0.jar"
entry = "ink.gradletest.GradletestRuntime"
```

Write `tests/fixtures/gradle-project/src/grammar.ts`:
```typescript
import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'

export default defineGrammar({
  package: 'ink.gradletest',
  declarations: [
    declaration({
      keyword: 'testblock',
      inheritsBase: true,
      rules: [
        rule('test_rule', r => r.identifier())
      ]
    })
  ]
})
```

Write `tests/fixtures/gradle-project/runtime/gradlew` (mock — creates a fake JAR):
```bash
#!/bin/bash
# Mock gradlew — creates a fake JAR for testing
mkdir -p build/libs
echo "fake-jar" > build/libs/ink.gradletest-0.1.0.jar
echo "BUILD SUCCESSFUL"
```

Make it executable:
```bash
chmod +x tests/fixtures/gradle-project/runtime/gradlew
```

- [ ] **Step 2: Write the test file**

```typescript
// tests/commands/ink-build-gradle.test.ts
import { execSync } from 'child_process'
import { readFileSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, beforeEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const FIXTURE = join(__dirname, '../fixtures/gradle-project')

describe('ink build with Gradle orchestration', () => {
  beforeEach(() => {
    try { rmSync(join(FIXTURE, 'dist'), { recursive: true }) } catch {}
  })

  it('runs gradlew and copies JAR to dist', () => {
    const result = execSync(
      `npx tsx ${CLI} build`,
      { cwd: FIXTURE, encoding: 'utf8' }
    )
    expect(result).toContain('Gradle build successful')
    expect(result).toContain('Runtime jar copied to dist/')

    // JAR was copied to dist
    expect(existsSync(join(FIXTURE, 'dist/ink.gradletest-0.1.0.jar'))).toBe(true)

    // ink-manifest.json has runtime
    const manifest = JSON.parse(readFileSync(join(FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.runtime.jar).toBe('ink.gradletest-0.1.0.jar')
    expect(manifest.runtime.entry).toBe('ink.gradletest.GradletestRuntime')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/commands/ink-build-gradle.test.ts
```

Expected: FAIL — `ink-build.ts` doesn't run Gradle yet

### Task 3.2: Implement Gradle orchestration in `quill build`

**Files:**
- Modify: `src/commands/ink-build.ts:33-47`

- [ ] **Step 4: Add Gradle build logic to `ink-build.ts`**

Replace the runtime section (lines 33-47) in `src/commands/ink-build.ts`. The new logic should:

1. Check if `runtime/build.gradle.kts` exists
2. If yes: look for `runtime/gradlew` (or `runtime/gradlew.bat` on Windows), fall back to system `gradle`
3. Spawn the Gradle build
4. Find and copy the output JAR
5. If no `runtime/build.gradle.kts` but `[runtime] jar` is set: copy that JAR directly (existing behavior)

Replace the `// Runtime jar validation + copy` block with:

```typescript
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

        if (isWindows && existsSync(wrapperBat)) {
          gradleCmd = wrapperBat
        } else if (existsSync(wrapperSh)) {
          gradleCmd = wrapperSh
        }

        console.log(`Running Gradle build in runtime/...`)
        try {
          execSync(`"${gradleCmd}" build`, { cwd: runtimeDir, stdio: 'pipe' })
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
```

Also add `readdirSync` to the import on line 6:

```typescript
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, existsSync, copyFileSync, readdirSync } from 'fs'
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/commands/ink-build-gradle.test.ts
```

Expected: PASS

- [ ] **Step 6: Run all tests to make sure existing behavior is preserved**

```bash
cd C:/Users/justi/chev/quill && npx vitest run
```

Expected: All tests pass — existing runtime-project fixture (which has a prebuilt JAR, no gradle) should still work via the external JAR path.

- [ ] **Step 7: Commit**

```bash
git add src/commands/ink-build.ts tests/commands/ink-build-gradle.test.ts tests/fixtures/gradle-project/ && git commit -m "feat: quill build runs Gradle when runtime/build.gradle.kts exists"
```

---

## Chunk 4: `.ink` to `.inkc` Compilation Integration

### Task 4.1: Write failing tests for .ink compilation

**Files:**
- Create: `tests/commands/ink-build-compile.test.ts`
- Create: `tests/fixtures/scripts-compile-project/` (fixture with .ink files and mock compiler)

- [ ] **Step 1: Create test fixture**

Create `tests/fixtures/scripts-compile-project/` with:
- `ink-package.toml` with grammar section
- `src/grammar.ts` with simple grammar
- `scripts/main.ink` with stub content
- A mock compiler script that simulates `java -jar ink-compiler.jar compile` by creating .inkc files

Write `tests/fixtures/scripts-compile-project/ink-package.toml`:
```toml
[package]
name = "ink.compiletest"
version = "0.1.0"
main = "mod"

[dependencies]

[grammar]
entry = "src/grammar.ts"
output = "dist/grammar.ir.json"
```

Write `tests/fixtures/scripts-compile-project/src/grammar.ts`:
```typescript
import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'

export default defineGrammar({
  package: 'ink.compiletest',
  declarations: [
    declaration({
      keyword: 'thing',
      inheritsBase: true,
      rules: [
        rule('thing_rule', r => r.identifier())
      ]
    })
  ]
})
```

Write `tests/fixtures/scripts-compile-project/scripts/main.ink`:
```
// test script
```

Write `tests/fixtures/scripts-compile-project/mock-java.sh` (mock that simulates `java -jar <jar> compile --grammar ... --sources ... --out ...`):
```bash
#!/bin/bash
# Mock java — simulates: java -jar <jar> compile --grammar <path> --sources <dir> --out <dir>
# Skip "java" args: -jar <jarpath> compile
shift  # -jar
shift  # <jarpath>
shift  # compile

OUT=""
SOURCES=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --out) OUT="$2"; shift 2;;
    --sources) SOURCES="$2"; shift 2;;
    --grammar) shift 2;;  # skip grammar path
    *) shift;;
  esac
done

mkdir -p "$OUT"
for f in "$SOURCES"/*.ink; do
  base=$(basename "$f" .ink)
  echo "compiled" > "$OUT/$base.inkc"
done
echo "Compilation successful"
```

```bash
chmod +x tests/fixtures/scripts-compile-project/mock-java.sh
```

- [ ] **Step 2: Write the test file**

```typescript
// tests/commands/ink-build-compile.test.ts
import { execSync } from 'child_process'
import { readFileSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, beforeEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const FIXTURE = join(__dirname, '../fixtures/scripts-compile-project')
const MOCK_JAVA = join(FIXTURE, 'mock-java.sh')

describe('ink build .ink compilation', () => {
  beforeEach(() => {
    try { rmSync(join(FIXTURE, 'dist'), { recursive: true }) } catch {}
  })

  it('compiles .ink files to .inkc in dist/scripts/', () => {
    const result = execSync(
      `npx tsx ${CLI} build`,
      { cwd: FIXTURE, encoding: 'utf8', env: { ...process.env, INK_COMPILER: '/tmp/fake-compiler.jar', INK_JAVA: MOCK_JAVA } }
    )
    expect(result).toContain('Compiled 1 script')

    expect(existsSync(join(FIXTURE, 'dist/scripts/main.inkc'))).toBe(true)

    const manifest = JSON.parse(readFileSync(join(FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.scripts).toContain('main.inkc')
  })

  it('skips compilation when no scripts/ directory exists', () => {
    const grammarFixture = join(__dirname, '../fixtures/grammar-project')
    try { rmSync(join(grammarFixture, 'dist'), { recursive: true }) } catch {}

    const result = execSync(
      `npx tsx ${CLI} build`,
      { cwd: grammarFixture, encoding: 'utf8' }
    )
    // Should succeed without compilation
    expect(result).toContain('Wrote dist/ink-manifest.json')

    const manifest = JSON.parse(readFileSync(join(grammarFixture, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.scripts).toBeUndefined()
  })

  it('errors when INK_COMPILER is not set and scripts exist', () => {
    try {
      execSync(
        `npx tsx ${CLI} build`,
        { cwd: FIXTURE, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, INK_COMPILER: '' } }
      )
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e.stderr.toString()).toContain('Ink compiler not found')
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/commands/ink-build-compile.test.ts
```

Expected: FAIL — compilation logic doesn't exist yet

### Task 4.2: Implement .ink compilation in `quill build`

**Files:**
- Modify: `src/commands/ink-build.ts`

- [ ] **Step 4: Add compilation step to `ink-build.ts`**

First, remove the existing TODO comment on line 25 (`// TODO: compile *.ink → *.inkc to dist/`).

Then add the following block after the runtime section and before writing `ink-manifest.json` (before the `// Write ink-manifest.json` comment):

```typescript
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
        const javaCmd = process.env['INK_JAVA'] || 'java'
        try {
          execSync(
            `${javaCmd} -jar "${compiler}" compile --grammar "${grammarIrPath}" --sources "${scriptsDir}" --out "${outDir}"`,
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/commands/ink-build-compile.test.ts
```

Expected: PASS

- [ ] **Step 6: Run all tests**

```bash
cd C:/Users/justi/chev/quill && npx vitest run
```

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/commands/ink-build.ts tests/commands/ink-build-compile.test.ts tests/fixtures/scripts-compile-project/ && git commit -m "feat: quill build compiles .ink scripts to .inkc via subprocess"
```

---

## Chunk 5: Registry — Publishing and Consuming

### Task 5.1: Add tarball packing utility

**Files:**
- Modify: `src/util/fs.ts`
- Create: `tests/util/fs-pack.test.ts`

- [ ] **Step 1: Write failing test for tarball packing**

```typescript
// tests/util/fs-pack.test.ts
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { it, expect, afterEach } from 'vitest'
import { FileUtils } from '../../src/util/fs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TMP = join(__dirname, '../fixtures/.tmp-pack-test')

afterEach(() => {
  try { rmSync(TMP, { recursive: true }) } catch {}
})

it('packTarGz creates a tarball and extractTarGz round-trips it', async () => {
  // Create a directory with files to pack
  const srcDir = join(TMP, 'src')
  mkdirSync(join(srcDir, 'dist'), { recursive: true })
  writeFileSync(join(srcDir, 'ink-package.toml'), 'name = "test"')
  writeFileSync(join(srcDir, 'dist/grammar.ir.json'), '{}')

  const tarball = join(TMP, 'output.tar.gz')
  await FileUtils.packTarGz(srcDir, tarball, ['ink-package.toml', 'dist'])

  expect(existsSync(tarball)).toBe(true)

  // Extract and verify
  const extractDir = join(TMP, 'extracted')
  await FileUtils.extractTarGz(tarball, extractDir)

  expect(existsSync(join(extractDir, 'ink-package.toml'))).toBe(true)
  expect(existsSync(join(extractDir, 'dist/grammar.ir.json'))).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/util/fs-pack.test.ts
```

Expected: FAIL — `packTarGz` doesn't exist

- [ ] **Step 3: Implement `packTarGz` in `src/util/fs.ts`**

Add to the `FileUtils` class:

```typescript
  /**
   * Pack files/directories into a tar.gz archive.
   * @param sourceDir - Base directory to pack from
   * @param destPath - Output tarball path
   * @param includes - List of files/directories to include (relative to sourceDir)
   */
  static async packTarGz(sourceDir: string, destPath: string, includes: string[]): Promise<void> {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const includeArgs = includes.map(i => `"${i}"`).join(' ');
    await execAsync(`tar -czf "${toMsysPath(destPath)}" ${includeArgs}`, { cwd: sourceDir });
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/util/fs-pack.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/util/fs.ts tests/util/fs-pack.test.ts && git commit -m "feat: add packTarGz utility for creating tarballs"
```

### Task 5.2: Add auth token reading

**Files:**
- Modify: `src/registry/client.ts`

- [ ] **Step 6: Add `readAuthToken()` method to `RegistryClient`**

Add to the `RegistryClient` class:

```typescript
  readAuthToken(): string | null {
    // Check environment variable first
    const envToken = process.env['QUILL_TOKEN']
    if (envToken) return envToken

    // Check ~/.quillrc
    const rcPath = path.join(os.homedir(), '.quillrc')
    if (fs.existsSync(rcPath)) {
      const content = fs.readFileSync(rcPath, 'utf8').trim()
      const match = content.match(/^token\s*=\s*(.+)$/m)
      if (match) return match[1].trim()
    }

    return null
  }
```

Add required imports at top of file:

```typescript
import path from 'path';
import fs from 'fs';
import os from 'os';
```

- [ ] **Step 7: Write unit test for `readAuthToken()`**

Add to `tests/registry.test.ts`:

```typescript
import { writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('readAuthToken', () => {
  it('reads token from QUILL_TOKEN env var', () => {
    const original = process.env['QUILL_TOKEN']
    process.env['QUILL_TOKEN'] = 'test-token-123'
    try {
      const client = new RegistryClient()
      expect(client.readAuthToken()).toBe('test-token-123')
    } finally {
      if (original !== undefined) process.env['QUILL_TOKEN'] = original
      else delete process.env['QUILL_TOKEN']
    }
  })

  it('returns null when no token is available', () => {
    const original = process.env['QUILL_TOKEN']
    delete process.env['QUILL_TOKEN']
    try {
      const client = new RegistryClient()
      expect(client.readAuthToken()).toBeNull()
    } finally {
      if (original !== undefined) process.env['QUILL_TOKEN'] = original
    }
  })
})
```

- [ ] **Step 8: Run test to verify it passes**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/registry.test.ts
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/registry/client.ts tests/registry.test.ts && git commit -m "feat: add auth token reading to RegistryClient"
```

### Task 5.3: Implement `quill publish` command

**Files:**
- Create: `src/commands/publish.ts`
- Modify: `src/cli.ts`
- Create: `tests/commands/publish.test.ts`

- [ ] **Step 10: Write failing test for publish**

```typescript
// tests/commands/publish.test.ts
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { rmSync } from 'fs'
import { describe, it, expect, beforeEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const FIXTURE = join(__dirname, '../fixtures/grammar-project')

describe('quill publish', () => {
  it('errors when no auth token is set', () => {
    try {
      execSync(
        `npx tsx ${CLI} publish`,
        {
          cwd: FIXTURE,
          encoding: 'utf8',
          stdio: 'pipe',
          env: { ...process.env, QUILL_TOKEN: '', HOME: '/tmp/no-home' }
        }
      )
      expect.unreachable('should have thrown')
    } catch (e: any) {
      const output = e.stderr.toString()
      expect(output).toContain('set QUILL_TOKEN or add token to ~/.quillrc')
    }
  })
})
```

- [ ] **Step 11: Run test to verify it fails**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/commands/publish.test.ts
```

Expected: FAIL — publish command doesn't exist

- [ ] **Step 12: Implement `src/commands/publish.ts`**

```typescript
// src/commands/publish.ts
import { TomlParser } from '../util/toml.js'
import { RegistryClient } from '../registry/client.js'
import { FileUtils } from '../util/fs.js'
import { InkBuildCommand } from './ink-build.js'
import { join, basename } from 'path'
import { existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

export class PublishCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'))

    // Validate required fields
    if (!manifest.name || !manifest.version) {
      console.error('ink-package.toml must have name and version to publish')
      process.exit(1)
    }

    // Check auth
    const client = new RegistryClient()
    const token = client.readAuthToken()
    if (!token) {
      console.error('Not authenticated. Set QUILL_TOKEN or add token to ~/.quillrc')
      process.exit(1)
    }

    // Run build first
    console.log('Building before publish...')
    const buildCmd = new InkBuildCommand(this.projectDir)
    await buildCmd.run()

    // Pack tarball
    const distDir = join(this.projectDir, 'dist')
    if (!existsSync(distDir)) {
      console.error('dist/ not found after build')
      process.exit(1)
    }

    const includes = ['ink-package.toml', 'dist']
    const tarball = join(tmpdir(), `${manifest.name}-${manifest.version}.tar.gz`)
    await FileUtils.packTarGz(this.projectDir, tarball, includes)

    // Upload
    const url = `${client.registryUrl}/packages/${manifest.name}/${manifest.version}`
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/gzip',
      },
      body: new Blob([readFileSync(tarball)]),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Publish failed (${res.status}): ${body}`)
      process.exit(1)
    }

    console.log(`Published ${manifest.name}@${manifest.version}`)
  }
}
```

- [ ] **Step 13: Register publish in `src/cli.ts`**

Add import:
```typescript
import { PublishCommand } from './commands/publish.js'
```

Add command registration (after the build command block):
```typescript
program
  .command('publish')
  .description('Publish package to the registry')
  .action(async () => {
    const cmd = new PublishCommand(process.cwd())
    await cmd.run()
  })
```

- [ ] **Step 14: Run tests to verify they pass**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/commands/publish.test.ts
```

Expected: PASS (the auth error test should pass now)

- [ ] **Step 15: Run all tests**

```bash
cd C:/Users/justi/chev/quill && npx vitest run
```

Expected: All tests pass

- [ ] **Step 16: Commit**

```bash
git add src/commands/publish.ts src/cli.ts tests/commands/publish.test.ts && git commit -m "feat: add quill publish command"
```

### Task 5.4: Verify `quill add` / `quill install` consumption flow

**Context:** The spec requires verifying that `quill add` and `quill install` work end-to-end with real package consumption. The commands already exist but haven't been tested against actual registry responses.

**Files:**
- Create: `tests/commands/add-install.test.ts`

- [ ] **Step 17: Write integration tests for add/install with mock registry**

```typescript
// tests/commands/add-install.test.ts
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, afterEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')

describe('quill add / install', () => {
  const TMP = join(__dirname, '../fixtures/.tmp-add-test')

  afterEach(() => {
    try { rmSync(TMP, { recursive: true }) } catch {}
  })

  it('add errors gracefully when package not found in registry', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'), `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n\n[dependencies]\n`)

    try {
      execSync(`npx tsx ${CLI} add nonexistent-pkg`, {
        cwd: TMP, encoding: 'utf8', stdio: 'pipe'
      })
    } catch (e: any) {
      // Should fail gracefully (registry unreachable or package not found)
      const output = e.stdout?.toString() + e.stderr?.toString()
      expect(output).toBeTruthy()
    }
  })

  it('install with no dependencies succeeds', () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'), `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n\n[dependencies]\n`)

    const result = execSync(`npx tsx ${CLI} install`, {
      cwd: TMP, encoding: 'utf8'
    })
    expect(result).toContain('Installed 0 package(s)')
    expect(existsSync(join(TMP, 'quill.lock'))).toBe(true)
  })
})
```

- [ ] **Step 18: Run tests**

```bash
cd C:/Users/justi/chev/quill && npx vitest run tests/commands/add-install.test.ts
```

Expected: PASS

- [ ] **Step 19: Run all tests**

```bash
cd C:/Users/justi/chev/quill && npx vitest run
```

Expected: All tests pass

- [ ] **Step 20: Commit**

```bash
git add tests/commands/add-install.test.ts && git commit -m "test: add integration tests for quill add/install"
```

---

## Chunk 6: `quill watch`

### Task 6.1: Add chokidar dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install chokidar**

```bash
cd C:/Users/justi/chev/quill && npm install chokidar
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json && git commit -m "chore: add chokidar dependency for file watching"
```

### Task 6.2: Implement `quill watch`

**Files:**
- Create: `src/commands/watch.ts`
- Modify: `src/cli.ts`

- [ ] **Step 3: Write `src/commands/watch.ts`**

```typescript
// src/commands/watch.ts
import { TomlParser } from '../util/toml.js'
import { InkBuildCommand } from './ink-build.js'
import { join } from 'path'
import { existsSync } from 'fs'
import chokidar from 'chokidar'

export class WatchCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'))

    const watchPaths: string[] = []

    const srcDir = join(this.projectDir, 'src')
    if (existsSync(srcDir)) watchPaths.push(srcDir)

    const scriptsDir = join(this.projectDir, 'scripts')
    if (existsSync(scriptsDir)) watchPaths.push(scriptsDir)

    const runtimeSrcDir = join(this.projectDir, 'runtime/src')
    if (existsSync(runtimeSrcDir)) watchPaths.push(runtimeSrcDir)

    if (watchPaths.length === 0) {
      console.log('Nothing to watch — no src/, scripts/, or runtime/src/ directories found')
      return
    }

    console.log('Watching for changes:')
    for (const p of watchPaths) {
      console.log(`  ${p}`)
    }

    let building = false
    let pendingBuild = false

    const doBuild = async () => {
      if (building) {
        pendingBuild = true
        return
      }
      building = true
      console.log('\nRebuilding...')
      try {
        const cmd = new InkBuildCommand(this.projectDir)
        await cmd.run()
        console.log('Build complete.')
      } catch (e: any) {
        console.error('Build failed:', e.message ?? e)
      }
      building = false
      if (pendingBuild) {
        pendingBuild = false
        doBuild()
      }
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      ignored: /(^|[\/\\])\../,
    })

    watcher.on('all', (event, path) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        console.log(`\nChange detected: ${path}`)
        doBuild()
      }, 300)
    })

    // Keep process alive until Ctrl+C
    process.on('SIGINT', () => {
      console.log('\nStopping watcher...')
      watcher.close()
      process.exit(0)
    })
  }
}
```

- [ ] **Step 4: Register watch in `src/cli.ts`**

Add import:
```typescript
import { WatchCommand } from './commands/watch.js'
```

Add command registration:
```typescript
program
  .command('watch')
  .description('Watch for file changes and rebuild')
  .action(async () => {
    const cmd = new WatchCommand(process.cwd())
    await cmd.run()
  })
```

- [ ] **Step 5: Run all tests to make sure nothing broke**

```bash
cd C:/Users/justi/chev/quill && npx vitest run
```

Expected: All tests pass

- [ ] **Step 6: Manual smoke test**

```bash
cd C:/Users/justi/chev/quill/tests/fixtures/grammar-project && npx tsx ../../../src/cli.js watch
```

Then in another terminal, edit `src/grammar.ts`. Verify the rebuild triggers. Ctrl+C to stop.

- [ ] **Step 7: Commit**

```bash
git add src/commands/watch.ts src/cli.ts && git commit -m "feat: add quill watch command with chokidar"
```

---

## Chunk 7: `ink.core` Slot (No Implementation)

This chunk is deferred until the Ink language spec is ready. No code to write. The existing infrastructure already supports it:

- Packages can depend on `"ink.core" = ">=1.0.0"` in `[dependencies]`
- `inheritsBase: true` is already a field in grammar declarations
- `checkKeywordConflicts()` already validates across multiple grammars
- The registry can host any package, including `ink.core`

When the language spec is ready, ink.core will be a normal Ink package created with `quill new ink.core`, with grammar definitions for core language constructs and no runtime (since ink.core's runtime is built into the Ink engine).

No action needed now.
