# `quill setup` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `quill setup` interactive wizard that prepares a Paper server for Ink scripts, and modify `quill build` to auto-deploy when a server path is configured.

**Architecture:** Extract shared server-setup helpers from `RunCommand` into `src/util/server-setup.ts`. New `SetupCommand` uses `@clack/prompts` for an interactive wizard that creates the server directory, downloads the Ink JAR, and initializes an ink-package.toml with `[server] path`. `InkBuildCommand` gets an optional deploy step that calls the existing `deployScripts()` and `deployGrammarJars()` when `manifest.server?.path` is set.

**Tech Stack:** TypeScript, `@clack/prompts` (new dependency), `@iarna/toml` (existing), Commander.js (existing), vitest (existing)

**Spec:** `docs/superpowers/specs/2026-03-28-quill-setup-wizard-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/util/server-setup.ts` | **Create** | Shared helpers: `ensureServerDir`, `downloadInkJar`, `resolveServerDir` (extracted from run.ts) |
| `src/commands/setup.ts` | **Create** | Interactive wizard using `@clack/prompts` |
| `src/commands/run.ts` | **Modify** | Import from `server-setup.ts` instead of inline helpers |
| `src/commands/ink-build.ts` | **Modify** | Add deploy step after build when `manifest.server?.path` is set |
| `src/cli.ts` | **Modify** | Register `setup` command in Project group |
| `tests/util/server-setup.test.ts` | **Create** | Unit tests for shared server setup helpers |
| `tests/commands/setup.test.ts` | **Create** | Unit tests for the setup wizard |
| `tests/commands/ink-build-deploy.test.ts` | **Create** | Unit tests for build deploy behavior |
| `package.json` | **Modify** | Add `@clack/prompts` dependency |

---

## Chunk 1: Shared Server Setup Module

Extract reusable helpers from `run.ts` into `src/util/server-setup.ts` so both `quill setup` and `quill run` share the same logic.

### Task 1: Install @clack/prompts and write failing tests for server-setup module

**Files:**
- Modify: `package.json`
- Create: `tests/util/server-setup.test.ts`

- [ ] **Step 1: Install @clack/prompts**

Run: `cd /c/Users/justi/dev/quill && npm install @clack/prompts`

- [ ] **Step 2: Write failing tests for server-setup module**

```typescript
// tests/util/server-setup.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ensureServerDir, downloadInkJar, resolveServerDir } from '../../src/util/server-setup.js'
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'

describe('ensureServerDir', () => {
  const tmpDir = join(os.tmpdir(), 'quill-server-setup-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates server directory with eula.txt and plugins structure', () => {
    ensureServerDir(tmpDir)
    expect(existsSync(tmpDir)).toBe(true)
    expect(readFileSync(join(tmpDir, 'eula.txt'), 'utf-8')).toBe('eula=true\n')
    expect(existsSync(join(tmpDir, 'plugins', 'Ink', 'scripts'))).toBe(true)
    expect(existsSync(join(tmpDir, 'plugins', 'Ink', 'plugins'))).toBe(true)
  })

  it('does not overwrite existing eula.txt', () => {
    ensureServerDir(tmpDir)
    // Write custom eula (writeFileSync already imported at top)
    const eulaPath = join(tmpDir, 'eula.txt')
    writeFileSync(eulaPath, 'eula=false\n')
    // Re-run — should not overwrite
    ensureServerDir(tmpDir)
    expect(readFileSync(eulaPath, 'utf-8')).toBe('eula=false\n')
  })

  it('is idempotent — safe to call multiple times', () => {
    ensureServerDir(tmpDir)
    ensureServerDir(tmpDir)
    ensureServerDir(tmpDir)
    expect(existsSync(join(tmpDir, 'eula.txt'))).toBe(true)
    expect(existsSync(join(tmpDir, 'plugins', 'Ink', 'scripts'))).toBe(true)
  })
})

describe('resolveServerDir', () => {
  it('resolves relative path against projectDir', () => {
    const result = resolveServerDir('/project', { server: { path: '.' } })
    expect(result).toBe('/project')
  })

  it('resolves relative subdirectory path', () => {
    const result = resolveServerDir('/project', { server: { path: './server' } })
    expect(result).toBe('/project/server')
  })

  it('uses absolute path as-is', () => {
    const result = resolveServerDir('/project', { server: { path: '/opt/minecraft/myserver' } })
    expect(result).toBe('/opt/minecraft/myserver')
  })

  it('falls back to ~/.quill/server/<target> when no server path', () => {
    const result = resolveServerDir('/project', { build: { target: 'paper' } })
    expect(result).toBe(join(os.homedir(), '.quill', 'server', 'paper'))
  })

  it('defaults target to "paper" when no build config', () => {
    const result = resolveServerDir('/project', {})
    expect(result).toBe(join(os.homedir(), '.quill', 'server', 'paper'))
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/util/server-setup.test.ts`
Expected: FAIL — module `../../src/util/server-setup.js` not found

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tests/util/server-setup.test.ts
git commit -m "test: add failing tests for server-setup shared module"
```

### Task 2: Implement server-setup module

**Files:**
- Create: `src/util/server-setup.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/util/server-setup.ts
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, isAbsolute } from 'path'
import { homedir } from 'os'
import { FileUtils } from './fs.js'
import type { PackageManifest } from '../model/manifest.js'

type ManifestSubset = Pick<PackageManifest, 'server' | 'target' | 'build'>

/**
 * Creates the server directory structure with eula.txt and plugins/ directories.
 * Safe to call multiple times — skips existing files/dirs.
 */
export function ensureServerDir(serverDir: string): void {
  mkdirSync(join(serverDir, 'plugins', 'Ink', 'scripts'), { recursive: true })
  mkdirSync(join(serverDir, 'plugins', 'Ink', 'plugins'), { recursive: true })

  const eulaPath = join(serverDir, 'eula.txt')
  if (!existsSync(eulaPath)) {
    writeFileSync(eulaPath, 'eula=true\n')
  }
}

/**
 * Downloads the latest Ink plugin JAR from GitHub releases.
 * Skips if an Ink JAR already exists in plugins/.
 * Returns the path to the JAR.
 */
export async function downloadInkJar(serverDir: string): Promise<string> {
  const inkJarPath = join(serverDir, 'plugins', 'Ink.jar')

  if (existsSync(inkJarPath)) {
    return inkJarPath
  }

  await FileUtils.downloadFileAtomic(
    'https://github.com/inklang/ink/releases/latest/download/Ink.jar',
    inkJarPath
  )

  return inkJarPath
}

/**
 * Resolves the server directory from manifest config.
 *   - absolute → use as-is
 *   - relative → join with projectDir
 *   - absent   → ~/.quill/server/<target>
 */
export function resolveServerDir(
  projectDir: string,
  manifest: ManifestSubset
): string {
  const serverPath = manifest.server?.path
  if (serverPath) {
    return isAbsolute(serverPath)
      ? serverPath
      : join(projectDir, serverPath)
  }
  const targetName = manifest.target ?? manifest.build?.target ?? 'paper'
  return join(homedir(), '.quill', 'server', targetName)
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/util/server-setup.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/util/server-setup.ts
git commit -m "feat: add shared server-setup module with ensureServerDir, downloadInkJar, resolveServerDir"
```

### Task 3: Refactor run.ts to use shared module + fix pre-existing test failures

**Files:**
- Modify: `src/commands/run.ts:1-70` (replace inline helpers with imports)
- Modify: `tests/commands/run.test.ts:1-38` (fix pre-existing failures + update imports)

**Pre-existing issue:** `tests/commands/run.test.ts` has 2 tests that expect `resolveServerDir` to return `~/.quill/server` but the actual implementation returns `~/.quill/server/<target>`. These tests are already failing before we start. We fix them here since the import path is changing anyway.

- [ ] **Step 1: Refactor run.ts imports and remove inline helpers**

In `src/commands/run.ts`:
- Remove the local `resolveServerDir` function (lines 23-35)
- Add import: `import { resolveServerDir, ensureServerDir, downloadInkJar } from '../util/server-setup.js'`
- Add a re-export so existing consumers can still import from run.ts: `export { resolveServerDir } from '../util/server-setup.js'`
- Refactor the `setup()` method (lines 219-263) to use `ensureServerDir()` and `downloadInkJar()` from the shared module
- Keep `deployScripts` and `deployGrammarJars` in run.ts since they're run-specific deploy helpers

- [ ] **Step 2: Fix pre-existing test failures in run.test.ts**

In `tests/commands/run.test.ts`:
- Update the import to include `resolveServerDir` from the new location (or keep importing from `run.js` since we re-export):
  ```typescript
  import { resolveServerDir, deployScripts, deployGrammarJars } from '../../src/commands/run.js'
  ```
  This still works because `run.ts` re-exports `resolveServerDir`.
- Fix the two failing assertions (lines 20 and 25) to expect the target suffix:
  ```typescript
  // Line 20: was path.join(os.homedir(), '.quill', 'server')
  expect(result).toBe(path.join(os.homedir(), '.quill', 'server', 'paper'))

  // Line 25: was path.join(os.homedir(), '.quill', 'server')
  expect(result).toBe(path.join(os.homedir(), '.quill', 'server', 'paper'))
  ```

- [ ] **Step 3: Run existing run tests to verify nothing broke**

Run: `npx vitest run tests/commands/run.test.ts tests/commands/run-deploy.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/run.ts tests/commands/run.test.ts
git commit -m "refactor: extract server setup helpers into shared module, fix pre-existing resolveServerDir test failures"
```

---

## Chunk 2: Setup Command

### Task 4: Write failing tests for SetupCommand

**Files:**
- Create: `tests/commands/setup.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/commands/setup.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SetupCommand } from '../../src/commands/setup.js'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'

describe('SetupCommand', () => {
  const tmpDir = join(os.tmpdir(), 'quill-setup-cmd-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates server dir, ink-package.toml, and scripts dir', async () => {
    const serverPath = join(tmpDir, 'myserver')
    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()

    // Server dir created
    expect(existsSync(serverPath)).toBe(true)
    expect(existsSync(join(serverPath, 'eula.txt'))).toBe(true)

    // ink-package.toml created with server path
    const tomlPath = join(serverPath, 'ink-package.toml')
    expect(existsSync(tomlPath)).toBe(true)
    const content = readFileSync(tomlPath, 'utf-8')
    expect(content).toContain('name = "myserver"')
    expect(content).toContain('path = "."')

    // scripts/ dir created
    expect(existsSync(join(serverPath, 'scripts'))).toBe(true)
  })

  it('uses existing server dir if valid', async () => {
    const serverPath = join(tmpDir, 'existing')
    mkdirSync(serverPath, { recursive: true })
    writeFileSync(join(serverPath, 'server.properties'), 'server-port=25565\n')

    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()

    // Should not overwrite server.properties
    expect(readFileSync(join(serverPath, 'server.properties'), 'utf-8')).toBe('server-port=25565\n')
    // Should still create ink-package.toml
    expect(existsSync(join(serverPath, 'ink-package.toml'))).toBe(true)
  })

  it('skips ink-package.toml if already exists', async () => {
    const serverPath = join(tmpDir, 'hasproject')
    mkdirSync(serverPath, { recursive: true })
    writeFileSync(join(serverPath, 'ink-package.toml'), '[package]\nname = "existing"\nversion = "1.0.0"\nmain = "main"\n')

    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()

    // Should not overwrite existing manifest
    const content = readFileSync(join(serverPath, 'ink-package.toml'), 'utf-8')
    expect(content).toContain('name = "existing"')
  })

  it('skips Ink JAR download if already present', async () => {
    const serverPath = join(tmpDir, 'hasink')
    mkdirSync(join(serverPath, 'plugins'), { recursive: true })
    writeFileSync(join(serverPath, 'plugins', 'Ink.jar'), 'fake-jar')
    writeFileSync(join(serverPath, 'server.properties'), '')

    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    // Should not throw or attempt download
    await cmd.run()
    // JAR should still be the fake one
    expect(readFileSync(join(serverPath, 'plugins', 'Ink.jar'), 'utf-8')).toBe('fake-jar')
  })

  it('sets server path to "." when project dir equals server dir', async () => {
    const serverPath = join(tmpDir, 'myserver')
    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()

    const content = readFileSync(join(serverPath, 'ink-package.toml'), 'utf-8')
    expect(content).toContain('path = "."')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/setup.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Commit**

```bash
git add tests/commands/setup.test.ts
git commit -m "test: add failing tests for SetupCommand"
```

### Task 5: Implement SetupCommand

**Files:**
- Create: `src/commands/setup.ts`

- [ ] **Step 1: Write the SetupCommand**

```typescript
// src/commands/setup.ts
import * as clack from '@clack/prompts'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import { TomlParser } from '../util/toml.js'
import type { PackageManifest } from '../model/manifest.js'
import { ensureServerDir, downloadInkJar } from '../util/server-setup.js'

export interface SetupOptions {
  skipPrompts?: boolean  // For testing — uses defaults for all prompts
}

export class SetupCommand {
  constructor(private serverPath: string, private options: SetupOptions = {}) {}

  async run(): Promise<void> {
    const s = this.options.skipPrompts
      ? clack.intro('Ink Server Setup')
      : clack.intro('🎮 Ink Server Setup')

    // Step 1: Server directory
    let serverDir = this.serverPath
    if (!this.options.skipPrompts) {
      const input = await clack.text({
        message: 'Path to your Paper server',
        initialValue: this.serverPath,
      })
      if (clack.isCancel(input)) { clack.cancel('Setup cancelled.'); process.exit(0) }
      serverDir = input as string
    }

    const serverExists = existsSync(serverDir)
    const hasServerProps = serverExists && existsSync(join(serverDir, 'server.properties'))

    if (!serverExists) {
      const shouldCreate = this.options.skipPrompts
        ? true
        : await clack.confirm({ message: `Directory "${serverDir}" not found. Create it?`, initialValue: true })
      if (clack.isCancel(shouldCreate) || !shouldCreate) {
        clack.cancel('Setup cancelled.')
        process.exit(0)
      }
    } else if (!hasServerProps) {
      const proceed = this.options.skipPrompts
        ? true
        : await clack.confirm({ message: 'This doesn\'t look like a Paper server (no server.properties). Continue anyway?', initialValue: false })
      if (clack.isCancel(proceed) || !proceed) {
        clack.cancel('Setup cancelled.')
        process.exit(0)
      }
    }

    const spin1 = clack.spinner()
    spin1.start('Creating server directory...')
    ensureServerDir(serverDir)
    spin1.stop('Server directory ready')

    // Step 2: Ink JAR
    const inkJarExists = existsSync(join(serverDir, 'plugins', 'Ink.jar')) ||
                         existsSync(join(serverDir, 'plugins', 'Ink-bukkit.jar'))

    if (!inkJarExists) {
      const shouldDownload = this.options.skipPrompts
        ? true
        : await clack.confirm({ message: 'Download Ink plugin?', initialValue: true })
      if (clack.isCancel(shouldDownload)) { clack.cancel('Setup cancelled.'); process.exit(0) }

      if (shouldDownload) {
        const spin2 = clack.spinner()
        spin2.start('Downloading Ink plugin...')
        try {
          await downloadInkJar(serverDir)
          spin2.stop('Ink plugin downloaded')
        } catch (e: any) {
          spin2.stop('Ink plugin download failed')
          clack.log.warn(`Could not download Ink JAR: ${e.message}`)
          clack.log.info('You can download it manually from https://github.com/inklang/ink/releases')
        }
      }
    } else {
      clack.log.success('Ink plugin already installed')
    }

    // Step 3: Initialize project
    const tomlPath = join(serverDir, 'ink-package.toml')
    if (!existsSync(tomlPath)) {
      const shouldInit = this.options.skipPrompts
        ? true
        : await clack.confirm({ message: 'Initialize Ink scripts project?', initialValue: true })
      if (clack.isCancel(shouldInit)) { clack.cancel('Setup cancelled.'); process.exit(0) }

      if (shouldInit) {
        const rawName = basename(serverDir).toLowerCase()
        const name = rawName.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'server'
        const manifest: PackageManifest = {
          name,
          version: '0.1.0',
          main: 'main',
          dependencies: {},
          server: { path: '.' },
        }
        writeFileSync(tomlPath, TomlParser.write(manifest))
        mkdirSync(join(serverDir, 'scripts'), { recursive: true })
        clack.log.success(`Created ink-package.toml: ${name} v0.1.0`)
      }
    } else {
      clack.log.success('ink-package.toml already exists')
    }

    // Summary
    clack.note(
      `1. Browse packages:  quill search <keyword>\n` +
      `   or visit: https://lectern.ink/packages\n\n` +
      `2. Add packages:     quill add <package-name>\n\n` +
      `3. Write scripts:    edit files in ${serverPath}/scripts/\n\n` +
      `4. Build & deploy:   quill build\n\n` +
      `5. Start server:     cd ${serverPath} && java -jar paper.jar`,
      'Next steps'
    )

    clack.outro('Setup complete!')
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/commands/setup.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/commands/setup.ts
git commit -m "feat: implement SetupCommand with @clack/prompts wizard"
```

### Task 6: Register setup command in CLI

**Files:**
- Modify: `src/cli.ts:1-28` (add import)
- Modify: `src/cli.ts:76-78` (add command registration before init)
- Modify: `src/cli.ts:299-300` (add to COMMAND_GROUPS)

- [ ] **Step 1: Add import and command registration**

In `src/cli.ts`, add import at top:
```typescript
import { SetupCommand } from './commands/setup.js'
```

Add command registration before the `init` command (around line 76):
```typescript
program
  .command('setup [path]')
  .description('Interactive wizard to set up a Paper server for Ink')
  .action(async (path?: string) => {
    await new SetupCommand(path ?? './server').run()
  })
```

Update `COMMAND_GROUPS` to include `'setup'` before `'init'`:
```typescript
{ title: 'Project', names: ['setup', 'new', 'init'] },
```

- [ ] **Step 2: Run all existing tests**

Run: `npx vitest run`
Expected: All existing tests pass

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: register quill setup command in CLI, add to Project group"
```

---

## Chunk 3: Build Deploy Step

### Task 7: Write failing tests for build deploy behavior

**Files:**
- Create: `tests/commands/ink-build-deploy.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// tests/commands/ink-build-deploy.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import os from 'os'

// We test the deploy behavior by directly calling the exported functions
// that ink-build.ts will use (deployScripts, deployGrammarJars from run.ts)
import { deployScripts, deployGrammarJars } from '../../src/commands/run.js'

describe('quill build deploy step', () => {
  const tmpDir = join(os.tmpdir(), 'quill-build-deploy-test')
  const projectDir = join(tmpDir, 'project')
  const serverDir = join(tmpDir, 'server')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(join(projectDir, 'dist', 'scripts'), { recursive: true })
    mkdirSync(join(serverDir, 'plugins', 'Ink', 'scripts'), { recursive: true })
    mkdirSync(join(serverDir, 'plugins', 'Ink', 'plugins'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deploys compiled scripts to server plugins dir', () => {
    writeFileSync(join(projectDir, 'dist', 'scripts', 'main.inkc'), 'bytecode-here')

    deployScripts(serverDir, projectDir)

    expect(existsSync(join(serverDir, 'plugins', 'Ink', 'scripts', 'main.inkc'))).toBe(true)
  })

  it('clears stale scripts before deploying', () => {
    // Existing stale script in server
    writeFileSync(join(serverDir, 'plugins', 'Ink', 'scripts', 'old.inkc'), 'stale')
    // New build output
    writeFileSync(join(projectDir, 'dist', 'scripts', 'main.inkc'), 'fresh')

    deployScripts(serverDir, projectDir)

    expect(existsSync(join(serverDir, 'plugins', 'Ink', 'scripts', 'old.inkc'))).toBe(false)
    expect(existsSync(join(serverDir, 'plugins', 'Ink', 'scripts', 'main.inkc'))).toBe(true)
  })

  it('deploys grammar JARs from dist/', () => {
    writeFileSync(join(projectDir, 'dist', 'my-grammar.jar'), 'jar-content')

    deployGrammarJars(serverDir, projectDir, 'paper')

    expect(existsSync(join(serverDir, 'plugins', 'Ink', 'plugins', 'my-grammar.jar'))).toBe(true)
  })

  it('handles missing server dir gracefully for deployScripts', () => {
    const badServerDir = join(tmpDir, 'nonexistent')
    mkdirSync(join(projectDir, 'dist', 'scripts'), { recursive: true })
    writeFileSync(join(projectDir, 'dist', 'scripts', 'main.inkc'), 'bytecode')

    // deployScripts clears and recreates, so mkdirSync handles missing dirs
    expect(() => deployScripts(badServerDir, projectDir)).not.toThrow()
    expect(existsSync(join(badServerDir, 'plugins', 'Ink', 'scripts', 'main.inkc'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they pass (these test existing functions)**

Run: `npx vitest run tests/commands/ink-build-deploy.test.ts`
Expected: PASS (these functions already exist and work)

- [ ] **Step 3: Commit**

```bash
git add tests/commands/ink-build-deploy.test.ts
git commit -m "test: add tests for build deploy behavior (deployScripts, deployGrammarJars)"
```

### Task 8: Add deploy step to InkBuildCommand

**Files:**
- Modify: `src/commands/ink-build.ts:21-269` (add deploy step at end of run())

- [ ] **Step 1: Add deploy logic to the end of InkBuildCommand.run()**

At the end of the `run()` method, after writing `ink-manifest.json` (around line 269), add:

```typescript
    // Deploy to server if [server] path is configured
    if (manifest.server?.path) {
      const { resolveServerDir } = await import('../util/server-setup.js')
      const serverDir = resolveServerDir(this.projectDir, manifest)

      if (!existsSync(serverDir)) {
        console.error(`Server directory not found: ${serverDir}`)
        console.error('Run `quill setup` first.')
        process.exit(1)
      }

      const inkPluginsDir = join(serverDir, 'plugins', 'Ink')
      if (!existsSync(inkPluginsDir)) {
        mkdirSync(join(inkPluginsDir, 'scripts'), { recursive: true })
        mkdirSync(join(inkPluginsDir, 'plugins'), { recursive: true })
        console.log('Warning: Ink plugin not found in server — created plugins/Ink/ directory')
      }

      // Deploy helpers from run.ts
      const { deployScripts: deployScriptsFn, deployGrammarJars: deployGrammarJarsFn } = await import('./run.js')
      const targetName = this.target ?? manifest.target ?? manifest.build?.target ?? 'default'

      deployScriptsFn(serverDir, this.projectDir)
      deployGrammarJarsFn(serverDir, this.projectDir, targetName)
      console.log(`Deployed to ${serverDir}`)
    }
```

Note: Dynamic imports are used because `ink-build.ts` and `run.ts` share many transitive imports (fs, path, etc.) and we want to avoid loading the full run module on every build. There is no circular dependency, but the lazy loading keeps the build command lightweight when no server path is configured.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (the deploy step only activates when `manifest.server?.path` is set, which existing test fixtures don't have)

- [ ] **Step 3: Commit**

```bash
git add src/commands/ink-build.ts
git commit -m "feat: quill build auto-deploys when server path is configured"
```

---

## Chunk 4: Integration Test and Cleanup

### Task 9: End-to-end integration test

**Files:**
- Create: `tests/commands/setup-integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/commands/setup-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SetupCommand } from '../../src/commands/setup.js'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { TomlParser } from '../../src/util/toml.js'

describe('setup integration', () => {
  const tmpDir = join(os.tmpdir(), 'quill-setup-integration-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('full setup creates valid project that quill can parse', async () => {
    const serverPath = join(tmpDir, 'myserver')
    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()

    // ink-package.toml is parseable by TomlParser
    const manifest = TomlParser.read(join(serverPath, 'ink-package.toml'))
    expect(manifest.name).toBe('myserver')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.server?.path).toBe('.')
  })

  it('re-running setup is idempotent', async () => {
    const serverPath = join(tmpDir, 'myserver')

    // First run
    await new SetupCommand(serverPath, { skipPrompts: true }).run()
    const firstContent = readFileSync(join(serverPath, 'ink-package.toml'), 'utf-8')

    // Second run
    await new SetupCommand(serverPath, { skipPrompts: true }).run()
    const secondContent = readFileSync(join(serverPath, 'ink-package.toml'), 'utf-8')

    // ink-package.toml unchanged
    expect(firstContent).toBe(secondContent)
  })

  it('setup with existing server preserves server.properties', async () => {
    const serverPath = join(tmpDir, 'existing-server')
    mkdirSync(serverPath, { recursive: true })
    writeFileSync(join(serverPath, 'server.properties'), 'server-port=25565\nmotd=My Server\n')

    await new SetupCommand(serverPath, { skipPrompts: true }).run()

    const props = readFileSync(join(serverPath, 'server.properties'), 'utf-8')
    expect(props).toBe('server-port=25565\nmotd=My Server\n')
    expect(existsSync(join(serverPath, 'ink-package.toml'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/commands/setup-integration.test.ts
git commit -m "test: add integration tests for quill setup end-to-end flow"
```

### Task 10: Final verification

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: TypeScript compiles without errors

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Smoke test the CLI**

Run: `node dist/cli.js setup --help`
Expected: Shows setup command help text

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: fix any remaining issues from integration testing"
```
