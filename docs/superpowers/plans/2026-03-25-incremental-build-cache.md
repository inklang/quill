# Incremental Build Cache Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add incremental build support to `quill build` via a local cache, avoiding full recompilation of unchanged `.ink` scripts. Also add `quill cache` and `quill cache clean` commands.

**Architecture:** Cache lives at `.quill/cache/manifest.json` per project. On incremental build, Quill hashes each `.ink` source file and only recompiles those whose hash differs from the manifest. Grammar IR changes invalidate all scripts. `--full` forces full recompilation and fresh manifest.

**Tech Stack:** Pure TypeScript/Node.js, SHA-256 via `crypto.createHash`, Commander.js for CLI, existing `printing_press compile <file>` single-file mode.

---

## Chunk 1: Cache module (`src/cache/`)

### Files

- **Create:** `src/cache/manifest.ts`
- **Create:** `src/cache/util.ts`
- **Create:** `src/cache/commands.ts`

---

### Task 1: `src/cache/manifest.ts`

**File:** `src/cache/manifest.ts`

- [ ] **Step 1: Write the manifest types and helpers**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface CacheEntry {
  hash: string
  output: string
  compiledAt: string
}

export interface CacheManifest {
  version: 1
  lastFullBuild: string
  grammarIrHash: string | null
  entries: Record<string, CacheEntry>
}

const MANIFEST_NAME = 'manifest.json'

export class CacheManifestStore {
  constructor(private cacheDir: string) {}

  private manifestPath(): string {
    return join(this.cacheDir, MANIFEST_NAME)
  }

  read(): CacheManifest | null {
    const path = this.manifestPath()
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as CacheManifest
    } catch {
      return null
    }
  }

  write(manifest: CacheManifest): void {
    mkdirSync(this.cacheDir, { recursive: true })
    writeFileSync(this.manifestPath(), JSON.stringify(manifest, null, 2))
  }
}
```

- [ ] **Step 2: Run build to check for syntax errors**

```bash
cd C:/Users/justi/dev/quill && npx tsc --noEmit src/cache/manifest.ts 2>&1 | head -20
```
Expected: No errors (or only type errors from missing imports, which will resolve when the module is wired up)

- [ ] **Step 3: Commit**

```bash
git add src/cache/manifest.ts && git commit -m "feat(cache): add manifest types and CacheManifestStore"
```

---

### Task 2: `src/cache/util.ts`

**File:** `src/cache/util.ts`

- [ ] **Step 1: Write hash and dirty-file detection utilities**

```typescript
import { createHash } from 'crypto'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import { CacheManifest, CacheEntry } from './manifest.js'

export function hashFile(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}

export function hashGrammarIr(distDir: string): string | null {
  const grammarPath = join(distDir, 'grammar.ir.json')
  if (!existsSync(grammarPath)) return null
  return hashFile(grammarPath)
}

export interface DirtyFile {
  relativePath: string
  hash: string
}

export function findDirtyFiles(
  projectDir: string,
  scriptsDir: string,
  manifest: CacheManifest | null
): DirtyFile[] {
  const dirty: DirtyFile[] = []
  if (!existsSync(scriptsDir)) return dirty

  const files = readdirSync(scriptsDir).filter(f => f.endsWith('.ink'))
  for (const file of files) {
    const fullPath = join(scriptsDir, file)
    const relPath = relative(projectDir, fullPath).replace(/\\/g, '/')
    const hash = hashFile(fullPath)
    const existing = manifest?.entries[relPath]

    if (!existing || existing.hash !== hash) {
      dirty.push({ relativePath: relPath, hash })
    }
  }

  // Also detect removed files: entries in manifest that no longer exist on disk
  if (manifest) {
    for (const relPath of Object.keys(manifest.entries)) {
      const fullPath = join(projectDir, relPath)
      if (!existsSync(fullPath)) {
        // File was deleted — treat as dirty (it will be absent from new manifest)
        // No action needed here; the manifest diff will handle it
      }
    }
  }

  return dirty
}

export function buildManifest(
  lastFullBuild: string,
  grammarIrHash: string | null,
  dirtyFiles: DirtyFile[]
): CacheManifest {
  const entries: Record<string, CacheEntry> = {}
  for (const f of dirtyFiles) {
    const output = f.relativePath.replace(/\.ink$/, '.inkc')
    entries[f.relativePath] = {
      hash: f.hash,
      output,
      compiledAt: new Date().toISOString(),
    }
  }
  return { version: 1, lastFullBuild, grammarIrHash, entries }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/justi/dev/quill && npx tsc --noEmit src/cache/util.ts 2>&1 | head -20
```
Expected: Only type errors from imports (will resolve when wired up)

- [ ] **Step 3: Commit**

```bash
git add src/cache/util.ts && git commit -m "feat(cache): add hash and dirty-file detection utilities"
```

---

### Task 3: `src/cache/commands.ts`

**File:** `src/cache/commands.ts`

- [ ] **Step 1: Write the cache command implementations**

```typescript
import { CacheManifestStore } from './manifest.js'
import { readdirSync, statSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

export class CacheCommand {
  constructor(private projectDir: string) {}

  run(): void {
    const cacheDir = join(this.projectDir, '.quill', 'cache')
    const store = new CacheManifestStore(cacheDir)
    const manifest = store.read()

    console.log(`Cache: .quill/cache`)

    if (!manifest) {
      console.log('No cache manifest found.')
      return
    }

    // Compute size
    let totalSize = 0
    const entries: { path: string; size: number }[] = []
    if (existsSync(cacheDir)) {
      for (const f of readdirSync(cacheDir)) {
        const full = join(cacheDir, f)
        const stat = statSync(full)
        if (stat.isFile()) {
          totalSize += stat.size
          entries.push({ path: f, size: stat.size })
        }
      }
    }

    const sizeKB = (totalSize / 1024).toFixed(1)
    console.log(`Size:   ${sizeKB} KB`)
    console.log(`Entries: ${Object.keys(manifest.entries).length}`)
    console.log(`Last full build: ${manifest.lastFullBuild ? new Date(manifest.lastFullBuild).toLocaleString() : 'none'}`)
    console.log('')

    for (const [relPath, entry] of Object.entries(manifest.entries)) {
      console.log(`${relPath}  ${entry.hash.slice(0, 7)}  →  ${entry.output}`)
    }
  }
}

export class CacheCleanCommand {
  constructor(private projectDir: string) {}

  run(): void {
    const cacheDir = join(this.projectDir, '.quill', 'cache')
    if (!existsSync(cacheDir)) {
      console.log('Nothing to clean (.quill/cache/ does not exist).')
      return
    }
    rmSync(cacheDir, { recursive: true, force: true })
    console.log('Removed .quill/cache/')
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/justi/dev/quill && npx tsc --noEmit src/cache/commands.ts 2>&1 | head -20
```
Expected: Only type errors from imports (will resolve when wired up)

- [ ] **Step 3: Commit**

```bash
git add src/cache/commands.ts && git commit -m "feat(cache): add quill cache and cache clean commands"
```

---

## Chunk 2: Integrate into `ink-build.ts` and `cli.ts`

### Files

- **Modify:** `src/commands/ink-build.ts` — add `--full` flag, incremental script compilation
- **Modify:** `src/cli.ts` — register `cache` and `cache clean` subcommands, add `--full` to `build`

---

### Task 4: Modify `src/cli.ts`

**File:** `src/cli.ts:93-100`

- [ ] **Step 1: Update the build command to add `--full` flag**

Change:
```typescript
program
  .command('build')
  .description('Compile grammar and/or Ink scripts')
  .action(async () => {
    requireProject()
    const cmd = new InkBuildCommand(process.cwd())
    await cmd.run()
  })
```

To:
```typescript
program
  .command('build')
  .description('Compile grammar and/or Ink scripts')
  .option('-F, --full', 'Force full recompilation of all scripts')
  .action(async (opts) => {
    requireProject()
    const cmd = new InkBuildCommand(process.cwd())
    await cmd.run({ full: !!opts.full })
  })
```

- [ ] **Step 2: Add cache and cache clean subcommands after the build command**

Add after line 100:
```typescript
program
  .command('cache')
  .description('Show build cache info')
  .action(async () => {
    requireProject()
    new CacheCommand(projectDir).run()
  })

program
  .command('cache clean')
  .description('Remove build cache')
  .action(async () => {
    requireProject()
    new CacheCleanCommand(projectDir).run()
  })
```

Also add the import at the top of the file:
```typescript
import { CacheCommand, CacheCleanCommand } from './cache/commands.js'
```

- [ ] **Step 3: Update COMMAND_GROUPS to include cache**

Change the Build group from:
```typescript
{ title: 'Build', names: ['build', 'check', 'watch', 'run'] },
```

To:
```typescript
{ title: 'Build',        names: ['build', 'check', 'watch', 'run'] },
{ title: 'Cache',        names: ['cache'] },
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd C:/Users/justi/dev/quill && npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors

- [ ] **Step 5: Run existing tests still pass**

```bash
cd C:/Users/justi/dev/quill && npm test 2>&1 | tail -30
```
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts && git commit -m "feat(cli): add --full flag to build and cache/cache clean commands"
```

---

### Task 5: Modify `src/commands/ink-build.ts`

**File:** `src/commands/ink-build.ts`

- [ ] **Step 1: Add new imports and update `run` signature**

Add to imports:
```typescript
import { CacheManifestStore } from '../cache/manifest.js'
import { hashFile, hashGrammarIr, findDirtyFiles, buildManifest, DirtyFile } from '../cache/util.js'
import { spawnSync } from 'child_process'
```

Change constructor + run from:
```typescript
export class InkBuildCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
```

To:
```typescript
export interface InkBuildOptions {
  full?: boolean
}

export class InkBuildCommand {
  constructor(private projectDir: string) {}

  async run(opts: InkBuildOptions = {}): Promise<void> {
```

- [ ] **Step 2: Replace the script compilation block (lines 107-177) with incremental logic**

The current block starting at "// Compile .ink scripts" (line 107) through line 177 handles all script compilation in batch mode. Replace the entire script compilation section with:

```typescript
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

        const outDir = join(distDir, 'scripts')
        mkdirSync(outDir, { recursive: true })

        if (opts.full) {
          // Full rebuild: batch mode + fresh manifest
          await this.compileScriptsBatch(compiler, scriptsDir, outDir, distDir)
          const grammarHash = hashGrammarIr(distDir)
          const dirtyFiles: DirtyFile[] = inkFiles.map(f => ({
            relativePath: `scripts/${f}`.replace(/\\/g, '/'),
            hash: hashFile(join(scriptsDir, f)),
          }))
          const manifest = buildManifest(new Date().toISOString(), grammarHash, dirtyFiles)
          const cacheStore = new CacheManifestStore(join(this.projectDir, '.quill', 'cache'))
          cacheStore.write(manifest)
        } else {
          // Incremental build
          const cacheStore = new CacheManifestStore(join(this.projectDir, '.quill', 'cache'))
          const cachedManifest = cacheStore.read()

          // Grammar IR change invalidates all scripts
          const currentGrammarHash = hashGrammarIr(distDir)
          const grammarChanged = cachedManifest && cachedManifest.grammarIrHash !== currentGrammarHash

          if (grammarChanged) {
            console.log('Grammar IR changed — invalidating script cache')
          }

          const dirtyFiles = grammarChanged
            ? inkFiles.map(f => ({
                relativePath: `scripts/${f}`.replace(/\\/g, '/'),
                hash: hashFile(join(scriptsDir, f)),
              }))
            : findDirtyFiles(this.projectDir, scriptsDir, cachedManifest)

          if (dirtyFiles.length === 0) {
            console.log('All scripts up to date — skipping compilation')
          } else {
            // Single-file mode per dirty file
            const compiledCount = await this.compileScriptsIncremental(compiler, dirtyFiles, scriptsDir, outDir)
            console.log(`Compiled ${compiledCount} script(s)`)

            // Merge new entries into manifest
            const grammarHash = currentGrammarHash
            const allEntries = { ...(cachedManifest?.entries ?? {}) }
            for (const f of dirtyFiles) {
              const output = f.relativePath.replace(/\.ink$/, '.inkc')
              allEntries[f.relativePath] = {
                hash: f.hash,
                output,
                compiledAt: new Date().toISOString(),
              }
            }
            const newManifest = {
              version: 1 as const,
              lastFullBuild: cachedManifest?.lastFullBuild ?? new Date().toISOString(),
              grammarIrHash: grammarHash,
              entries: allEntries,
            }
            cacheStore.write(newManifest)
          }
        }

        const compiledFiles = readdirSync(outDir).filter(f => f.endsWith('.inkc'))
        inkManifest.scripts = compiledFiles
      }
    }
```

- [ ] **Step 3: Add `compileScriptsBatch` and `compileScriptsIncremental` helper methods**

Add these two methods to the `InkBuildCommand` class (after the existing private methods, before the closing `}`):

```typescript
  private async compileScriptsBatch(
    compiler: string,
    scriptsDir: string,
    outDir: string,
    distDir: string
  ): Promise<void> {
    const isPrintingPress = compiler.endsWith('printing_press') || compiler.endsWith('printing_press.exe')
    const compilerPath = compiler.replace(/\\/g, '/')
    const scriptsDirFwd = scriptsDir.replace(/\\/g, '/')
    const outDirFwd = outDir.replace(/\\/g, '/')

    if (isPrintingPress) {
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
      const inkManifestPath = join(distDir, 'ink-manifest.json')
      const inkManifest = existsSync(inkManifestPath)
        ? JSON.parse(readFileSync(inkManifestPath, 'utf8'))
        : {}
      const grammarFlags = inkManifest.grammar
        ? `--grammar "${join(distDir, inkManifest.grammar as string).replace(/\\/g, '/')}" `
        : ''
      const javaCmd = (process.env['INK_JAVA'] || 'java').replace(/\\/g, '/')

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
  }

  private async compileScriptsIncremental(
    compiler: string,
    dirtyFiles: DirtyFile[],
    scriptsDir: string,
    outDir: string
  ): Promise<number> {
    const isPrintingPress = compiler.endsWith('printing_press') || compiler.endsWith('printing_press.exe')
    const compilerPath = compiler.replace(/\\/g, '/')
    let compiled = 0

    for (const dirty of dirtyFiles) {
      const inputPath = join(this.projectDir, dirty.relativePath)
      const outputPath = join(outDir, dirty.relativePath.replace(/\.ink$/, '.inkc'))

      // Ensure output subdirectory exists
      mkdirSync(dirname(outputPath), { recursive: true })

      const inputFwd = inputPath.replace(/\\/g, '/')
      const outputFwd = outputPath.replace(/\\/g, '/')

      let ok = false
      if (isPrintingPress) {
        const result = spawnSync(`"${compilerPath}" compile "${inputFwd}" -o "${outputFwd}"`, {
          shell: true,
          cwd: this.projectDir,
        })
        ok = result.status === 0
      } else {
        const javaCmd = (process.env['INK_JAVA'] || 'java').replace(/\\/g, '/')
        const result = spawnSync(
          `"${javaCmd}" -jar "${compilerPath}" compile "${inputFwd}" -o "${outputFwd}"`,
          { shell: true, cwd: this.projectDir }
        )
        ok = result.status === 0
      }

      if (!ok) {
        console.error(`Failed to compile ${dirty.relativePath}`)
        process.exit(1)
      }
      compiled++
    }

    return compiled
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd C:/Users/justi/dev/quill && npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors

- [ ] **Step 5: Run existing tests still pass**

```bash
cd C:/Users/justi/dev/quill && npm test 2>&1 | tail -30
```
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/ink-build.ts && git commit -m "feat(build): add incremental script compilation with --full flag"
```

---

## Chunk 3: Tests

### Files

- **Create:** `tests/cache/manifest.test.ts`
- **Create:** `tests/cache/util.test.ts`
- **Create:** `tests/commands/cache.test.ts`
- **Modify:** `tests/commands/ink-build.test.ts` — add incremental build test

---

### Task 6: `tests/cache/manifest.test.ts`

**File:** `tests/cache/manifest.test.ts`

- [ ] **Step 1: Write manifest store tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { CacheManifestStore, CacheManifest } from '../../src/cache/manifest.js'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('CacheManifestStore', () => {
  let tmp: string
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'quill-cache-test-')) })

  it('read returns null when manifest does not exist', () => {
    const store = new CacheManifestStore(join(tmp, 'cache'))
    expect(store.read()).toBeNull()
  })

  it('write then read returns the manifest', () => {
    const store = new CacheManifestStore(join(tmp, 'cache'))
    const manifest: CacheManifest = {
      version: 1,
      lastFullBuild: '2026-03-25T12:00:00.000Z',
      grammarIrHash: 'abc123',
      entries: {
        'scripts/hello.ink': {
          hash: 'def456',
          output: 'hello.inkc',
          compiledAt: '2026-03-25T12:00:01.000Z',
        },
      },
    }
    store.write(manifest)
    const read = store.read()
    expect(read).toEqual(manifest)
  })

  it('read returns null for invalid JSON', () => {
    const cacheDir = join(tmp, 'cache')
    writeFileSync(join(cacheDir, 'manifest.json'), 'not json')
    const store = new CacheManifestStore(cacheDir)
    expect(store.read()).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd C:/Users/justi/dev/quill && npx vitest run tests/cache/manifest.test.ts 2>&1
```
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add tests/cache/manifest.test.ts && git commit -m "test(cache): add manifest store tests"
```

---

### Task 7: `tests/cache/util.test.ts`

**File:** `tests/cache/util.test.ts`

- [ ] **Step 1: Write hash and dirty-file detection tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { hashFile, findDirtyFiles, buildManifest } from '../../src/cache/util.js'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('hashFile', () => {
  it('returns consistent SHA-256 hash', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'quill-util-test-'))
    writeFileSync(join(tmp, 'test.ink'), 'Hello, world!')
    const h1 = hashFile(join(tmp, 'test.ink'))
    const h2 = hashFile(join(tmp, 'test.ink'))
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64) // SHA-256 hex
  })

  it('different content produces different hash', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'quill-util-test-'))
    writeFileSync(join(tmp, 'a.ink'), 'content a')
    writeFileSync(join(tmp, 'b.ink'), 'content b')
    expect(hashFile(join(tmp, 'a.ink'))).not.toBe(hashFile(join(tmp, 'b.ink')))
  })
})

describe('findDirtyFiles', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'quill-util-test-'))
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
  })

  it('returns all files as dirty when no manifest exists', () => {
    writeFileSync(join(tmp, 'scripts', 'hello.ink'), 'hello')
    writeFileSync(join(tmp, 'scripts', 'fight.ink'), 'fight')
    const dirty = findDirtyFiles(tmp, join(tmp, 'scripts'), null)
    expect(dirty).toHaveLength(2)
    expect(dirty.map(d => d.relativePath)).toContain('scripts/hello.ink')
    expect(dirty.map(d => d.relativePath)).toContain('scripts/fight.ink')
  })

  it('returns only changed files as dirty', () => {
    writeFileSync(join(tmp, 'scripts', 'hello.ink'), 'hello')
    const { hash } = findDirtyFiles(tmp, join(tmp, 'scripts'), null)[0]

    // Manifest with correct hash for hello.ink, wrong for fight.ink
    const manifest = {
      version: 1 as const,
      lastFullBuild: new Date().toISOString(),
      grammarIrHash: null,
      entries: {
        'scripts/hello.ink': { hash, output: 'hello.inkc', compiledAt: new Date().toISOString() },
      },
    }

    writeFileSync(join(tmp, 'scripts', 'fight.ink'), 'fight')
    const dirty = findDirtyFiles(tmp, join(tmp, 'scripts'), manifest)
    expect(dirty).toHaveLength(1)
    expect(dirty[0].relativePath).toBe('scripts/fight.ink')
  })

  it('returns modified file as dirty', () => {
    writeFileSync(join(tmp, 'scripts', 'hello.ink'), 'original')
    const dirty = findDirtyFiles(tmp, join(tmp, 'scripts'), null)
    const originalHash = dirty[0].hash

    // Update file content
    writeFileSync(join(tmp, 'scripts', 'hello.ink'), 'modified')

    const manifest = {
      version: 1 as const,
      lastFullBuild: new Date().toISOString(),
      grammarIrHash: null,
      entries: {
        'scripts/hello.ink': { hash: originalHash, output: 'hello.inkc', compiledAt: new Date().toISOString() },
      },
    }

    const dirty2 = findDirtyFiles(tmp, join(tmp, 'scripts'), manifest)
    expect(dirty2).toHaveLength(1)
    expect(dirty2[0].relativePath).toBe('scripts/hello.ink')
  })
})

describe('buildManifest', () => {
  it('builds a valid manifest', () => {
    const dirtyFiles = [
      { relativePath: 'scripts/hello.ink', hash: 'abc123' },
    ]
    const manifest = buildManifest('2026-03-25T12:00:00Z', 'grammarhash', dirtyFiles)
    expect(manifest.version).toBe(1)
    expect(manifest.entries['scripts/hello.ink'].hash).toBe('abc123')
    expect(manifest.entries['scripts/hello.ink'].output).toBe('hello.inkc')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd C:/Users/justi/dev/quill && npx vitest run tests/cache/util.test.ts 2>&1
```
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add tests/cache/util.test.ts && git commit -m "test(cache): add hash and dirty-file detection tests"
```

---

### Task 8: `tests/commands/ink-build.test.ts` — add incremental build test

**File:** `tests/commands/ink-build.test.ts`

- [ ] **Step 1: Add incremental build test to existing file**

Add at the end of the file (after line 36):

```typescript
it('ink build --full forces full rebuild and updates manifest', () => {
  // First build
  execSync(
    `npx tsx ${join(__dirname, '../../src/cli.js')} build`,
    { cwd: FIXTURE, encoding: 'utf8' }
  )

  // Touch one file
  const helloPath = join(FIXTURE, 'scripts', 'hello.ink')
  const original = readFileSync(helloPath, 'utf8')
  writeFileSync(helloPath, original + '\n// modified')

  try {
    // --full should recompile all
    const result = execSync(
      `npx tsx ${join(__dirname, '../../src/cli.js')} build --full`,
      { cwd: FIXTURE, encoding: 'utf8' }
    )
    expect(result).toContain('Compiled')

    const manifest = JSON.parse(readFileSync(join(FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.scripts).toBeDefined()
  } finally {
    writeFileSync(helloPath, original)
  }
})

it('quill cache shows cache info', () => {
  const result = execSync(
    `npx tsx ${join(__dirname, '../../src/cli.js')} cache`,
    { cwd: FIXTURE, encoding: 'utf8' }
  )
  expect(result).toContain('Cache:')
})

it('quill cache clean removes cache', () => {
  // Ensure cache exists first
  execSync(`npx tsx ${join(__dirname, '../../src/cli.js')} build`, { cwd: FIXTURE })

  const result = execSync(
    `npx tsx ${join(__dirname, '../../src/cli.js')} cache clean`,
    { cwd: FIXTURE, encoding: 'utf8' }
  )
  expect(result).toContain('Removed')
})
```

Need to add `writeFileSync` to the existing imports at the top of the test file.

- [ ] **Step 2: Run the new tests**

```bash
cd C:/Users/justi/dev/quill && npx vitest run tests/commands/ink-build.test.ts 2>&1
```
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add tests/commands/ink-build.test.ts && git commit -m "test(build): add incremental build and cache command tests"
```

---

## Verification

After all chunks, run:

```bash
cd C:/Users/justi/dev/quill && npm test 2>&1
```

All tests should pass. Also verify manually:

```bash
cd tests/fixtures/grammar-project && npx tsx ../../../src/cli.js build
# Should say "All scripts up to date"
cd tests/fixtures/grammar-project && npx tsx ../../../src/cli.js cache
# Should show cache info
cd tests/fixtures/grammar-project && npx tsx ../../../src/cli.js cache clean
# Should remove cache
cd tests/fixtures/grammar-project && npx tsx ../../../src/cli.js build --full
# Should do a full rebuild
```
