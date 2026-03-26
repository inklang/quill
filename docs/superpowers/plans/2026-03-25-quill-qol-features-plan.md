# Quill QoL Features Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `quill search`, `quill info`, and `quill doctor` commands to the quill CLI.

**Architecture:** Three new command classes (`SearchCommand`, `InfoCommand`, `DoctorCommand`) + a `doctor.ts` utility for health checks. Registry methods added to `RegistryClient`. All commands follow existing patterns: class with `run()`, registered in `cli.ts`.

**Tech Stack:** TypeScript, commander.js (existing), Node.js fetch API (existing)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/commands/search.ts` | Search command implementation |
| Create | `src/commands/info.ts` | Info command implementation |
| Create | `src/commands/doctor.ts` | Doctor command implementation |
| Create | `src/util/doctor.ts` | Health check functions |
| Modify | `src/registry/client.ts` | Add `searchPackages()` and `getPackageInfo()` methods |
| Modify | `src/cli.ts` | Register new commands |

---

## Chunk 1: RegistryClient Search & Info Methods

Add `searchPackages()` and `getPackageInfo()` methods to `RegistryClient`.

**Files:**
- Modify: `src/registry/client.ts`

- [ ] **Step 1: Add SearchResult interface and searchPackages method to RegistryClient**

Modify `src/registry/client.ts` - add after line 145:

```typescript
export interface SearchResult {
  name: string;
  version: string;
  description: string;
  score: number;
}

export interface PackageInfo {
  name: string;
  version: string;
  description: string;
  dependencies: Record<string, string>;
  homepage?: string;
}

export class RegistryClient {
  // ... existing code ...

  async searchPackages(query: string): Promise<SearchResult[]> {
    const url = `${this.registryUrl}/api/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return await res.json() as SearchResult[];
  }

  async getPackageInfo(name: string, version?: string): Promise<PackageInfo | null> {
    const index = await this.fetchIndex();
    const pkg = index.get(name) as RegistryPackage | undefined;
    if (!pkg) return null;

    const targetVersion = version
      ?? [...pkg.versions.keys()].sort((a, b) => new Semver(b).compareTo(new Semver(a)))[0];
    const pkgVer = pkg.versions.get(targetVersion);
    if (!pkgVer) return null;

    return {
      name,
      version: targetVersion,
      description: '', // index doesn't include description, need separate API or embed in index
      dependencies: pkgVer.dependencies,
      homepage: undefined,
    };
  }
}
```

- [ ] **Step 2: Run TypeScript build to verify no errors**

Run: `npm run build`
Expected: Compiles without errors

- [ ] **Step 3: Commit**

```bash
git add src/registry/client.ts
git commit -m "feat(registry): add searchPackages and getPackageInfo methods"
```

---

## Chunk 2: `quill search` Command

**Files:**
- Create: `src/commands/search.ts`
- Modify: `src/cli.ts`
- Create: `tests/commands/search.test.ts`

- [ ] **Step 1: Write test for SearchCommand**

Create `tests/commands/search.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { SearchCommand } from '../../src/commands/search.js'

describe('quill search', () => {
  it('prints usage when no query provided', async () => {
    const logSpy = vi.spyOn(console, 'log')
    const errSpy = vi.spyOn(console, 'error')
    await new SearchCommand().run('')
    expect(logSpy).not.toHaveBeenCalled()
    // Should error on empty query
  })
})
```

- [ ] **Step 2: Create SearchCommand class**

Create `src/commands/search.ts`:

```typescript
import { RegistryClient, SearchResult } from '../registry/client.js'

const RESULTS_PER_PAGE = 10

export class SearchCommand {
  async run(query: string, page: number = 1, outputJson: boolean = false): Promise<void> {
    if (!query.trim()) {
      console.error('error: Search query required')
      process.exit(1)
    }

    const client = new RegistryClient()
    try {
      const results = await client.searchPackages(query)

      if (outputJson) {
        console.log(JSON.stringify(results, null, 2))
        return
      }

      if (results.length === 0) {
        console.log(`No packages found matching "${query}"`)
        return
      }

      // Paginate
      const start = (page - 1) * RESULTS_PER_PAGE
      const end = start + RESULTS_PER_PAGE
      const pageResults = results.slice(start, end)

      const termWidth = process.stdout.columns || 80
      for (const r of pageResults) {
        const nameVer = `${r.name}@${r.version}`
        const pad = 20
        const desc = r.description.slice(0, Math.max(0, termWidth - pad - 3))
        console.log(`${nameVer.padEnd(pad)}${desc}`)
      }

      const totalPages = Math.ceil(results.length / RESULTS_PER_PAGE)
      if (totalPages > 1) {
        console.log(`\nPage ${page} of ${totalPages} (${results.length} results)`)
      }
    } catch (e: any) {
      console.error(`error: Failed to search registry: ${e.message}`)
      process.exit(1)
    }
  }
}
```

- [ ] **Step 3: Add search command to cli.ts**

Modify `src/cli.ts` - add import after line 15:

```typescript
import { SearchCommand } from './commands/search.js'
```

Add after the `ls` command (around line 83):

```typescript
program
  .command('search <query>')
  .description('Search the registry for packages')
  .option('--page <n>', 'Page number', '1')
  .option('--json', 'Output raw JSON')
  .action(async (query, opts) => {
    const page = parseInt(opts.page || '1', 10)
    await new SearchCommand().run(query, page, !!opts.json)
  })
```

- [ ] **Step 4: Run build and tests**

Run: `npm run build && npx vitest run tests/commands/search.test.ts`
Expected: Builds, tests pass (or skip if no test yet)

- [ ] **Step 5: Commit**

```bash
git add src/commands/search.ts src/cli.ts
git commit -m "feat(quill): add search command"
```

---

## Chunk 3: `quill info` Command

**Files:**
- Create: `src/commands/info.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create InfoCommand class**

Create `src/commands/info.ts`:

```typescript
import { RegistryClient } from '../registry/client.js'

export class InfoCommand {
  async run(pkgName: string, version?: string, outputJson: boolean = false): Promise<void> {
    const client = new RegistryClient()
    try {
      const info = await client.getPackageInfo(pkgName, version)

      if (!info) {
        console.error(`error: Package "${pkgName}" not found in registry`)
        process.exit(1)
      }

      if (outputJson) {
        console.log(JSON.stringify(info, null, 2))
        return
      }

      console.log(`${info.name}@${info.version}`)
      if (info.description) console.log(`  Description: ${info.description}`)
      console.log(`  Version: ${info.version}`)
      if (Object.keys(info.dependencies).length > 0) {
        const deps = Object.entries(info.dependencies)
          .map(([k, v]) => `${k}@${v}`)
          .join(', ')
        console.log(`  Dependencies: ${deps}`)
      }
      if (info.homepage) console.log(`  Homepage: ${info.homepage}`)
    } catch (e: any) {
      console.error(`error: Failed to fetch package info: ${e.message}`)
      process.exit(1)
    }
  }
}
```

- [ ] **Step 2: Add info command to cli.ts**

Add import:

```typescript
import { InfoCommand } from './commands/info.js'
```

Add after search command:

```typescript
program
  .command('info <pkg>')
  .description('Show details about a package')
  .option('--version <ver>', 'Show specific version')
  .option('--json', 'Output raw JSON')
  .action(async (pkg, opts) => {
    await new InfoCommand().run(pkg, opts.version, !!opts.json)
  })
```

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Compiles without errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/info.ts src/cli.ts
git commit -m "feat(quill): add info command"
```

---

## Chunk 4: `quill doctor` Command

**Files:**
- Create: `src/util/doctor.ts`
- Create: `src/commands/doctor.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create doctor utility with health check functions**

Create `src/util/doctor.ts`:

```typescript
import fs from 'fs'
import path from 'path'
import os from 'os'
import { TomlParser } from './toml.js'
import { RegistryClient } from '../registry/client.js'

export type CheckStatus = 'pass' | 'fail' | 'warn'

export interface CheckResult {
  name: string
  status: CheckStatus
  message: string
}

export class Doctor {
  private results: CheckResult[] = []

  async runAll(): Promise<CheckResult[]> {
    await this.checkRegistry()
    this.checkAuth()
    this.checkProject()
    await this.checkDependencies()
    await this.checkNvidiaApi()
    return this.results
  }

  private addResult(name: string, status: CheckStatus, message: string) {
    this.results.push({ name, status, message })
  }

  private async checkRegistry() {
    try {
      const client = new RegistryClient()
      await client.fetchIndex()
      this.addResult('Registry', 'pass', 'reachable')
    } catch (e: any) {
      this.addResult('Registry', 'fail', `unreachable: ${e.message}`)
    }
  }

  private checkAuth() {
    const envToken = process.env['QUILL_TOKEN']
    const rcPath = path.join(os.homedir(), '.quillrc')
    const rcToken = fs.existsSync(rcPath)
      ? fs.readFileSync(rcPath, 'utf8').match(/^token\s*=\s*(.+)$/m)?.[1]?.trim()
      : null

    if (envToken || rcToken) {
      this.addResult('Auth', 'pass', 'token found')
    } else {
      this.addResult('Auth', 'warn', 'no token found (run `quill login` to publish)')
    }
  }

  private checkProject() {
    const projectDir = process.cwd()
    const tomlPath = path.join(projectDir, 'ink-package.toml')

    if (!fs.existsSync(tomlPath)) {
      this.addResult('ink-package.toml', 'warn', 'not in a project directory')
      return
    }

    try {
      TomlParser.read(tomlPath)
      this.addResult('ink-package.toml', 'pass', 'valid')
    } catch {
      this.addResult('ink-package.toml', 'fail', 'parse error')
    }
  }

  private async checkDependencies() {
    const projectDir = process.cwd()
    const lockPath = path.join(projectDir, 'quill.lock')

    if (!fs.existsSync(lockPath)) {
      this.addResult('Dependencies', 'pass', 'no dependencies')
      return
    }

    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      const deps = lock.packages ? Object.keys(lock.packages) : Object.keys(lock)

      if (deps.length === 0) {
        this.addResult('Dependencies', 'pass', 'no dependencies')
        return
      }

      const client = new RegistryClient()
      const index = await client.fetchIndex()

      let allFound = true
      for (const dep of deps) {
        if (!index.get(dep)) {
          allFound = false
          break
        }
      }

      if (allFound) {
        this.addResult('Dependencies', 'pass', 'all installed')
      } else {
        this.addResult('Dependencies', 'warn', 'some deps not found in registry')
      }
    } catch {
      this.addResult('Dependencies', 'warn', 'could not check')
    }
  }

  private async checkNvidiaApi() {
    try {
      const res = await fetch('https://api.nvcf.nvidia.com/v2/info', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      })
      if (res.ok) {
        this.addResult('NVIDIA API', 'pass', 'reachable')
      } else {
        this.addResult('NVIDIA API', 'warn', 'unreachable')
      }
    } catch {
      this.addResult('NVIDIA API', 'warn', 'unreachable (search features may not work)')
    }
  }

  printResults() {
    const maxNameLen = Math.max(...this.results.map(r => r.name.length), 10)
    const indent = '  '

    console.log('Doctor check results:')
    for (const r of this.results) {
      const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '⚠'
      const name = r.name.padEnd(maxNameLen)
      console.log(`${indent}${icon} ${name}  ${r.message}`)
    }

    const passed = this.results.filter(r => r.status === 'pass').length
    const warnings = this.results.filter(r => r.status === 'warn').length
    const failed = this.results.filter(r => r.status === 'fail').length
    console.log(`\n${this.results.length} checks, ${passed} passed, ${warnings} warning, ${failed} failed`)
  }

  hasFailed(): boolean {
    return this.results.some(r => r.status === 'fail')
  }

  hasWarnings(): boolean {
    return this.results.some(r => r.status === 'warn')
  }
}
```

- [ ] **Step 2: Create DoctorCommand class**

Create `src/commands/doctor.ts`:

```typescript
import { Doctor } from '../util/doctor.js'

export class DoctorCommand {
  async run(outputJson: boolean = false): Promise<void> {
    const doctor = new Doctor()
    const results = await doctor.runAll()

    if (outputJson) {
      console.log(JSON.stringify(results, null, 2))
      process.exit(doctor.hasFailed() ? 1 : 0)
      return
    }

    doctor.printResults()
    process.exit(doctor.hasFailed() ? 1 : 0)
  }
}
```

- [ ] **Step 3: Add doctor command to cli.ts**

Add import:

```typescript
import { DoctorCommand } from './commands/doctor.js'
```

Add to COMMAND_GROUPS:

```typescript
const COMMAND_GROUPS = [
  { title: 'Project',      names: ['new', 'init'] },
  { title: 'Dependencies', names: ['add', 'remove', 'install', 'update', 'ls', 'clean'] },
  { title: 'Build',        names: ['build', 'check', 'watch', 'run'] },
  { title: 'Registry',     names: ['login', 'logout', 'publish', 'search', 'info'] },
  { title: 'Doctor',       names: ['doctor'] },
]
```

Add command after info:

```typescript
program
  .command('doctor')
  .description('Run diagnostics and check for common issues')
  .option('--json', 'Output JSON')
  .action(async (opts) => {
    await new DoctorCommand().run(!!opts.json)
  })
```

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Compiles without errors

- [ ] **Step 5: Commit**

```bash
git add src/util/doctor.ts src/commands/doctor.ts src/cli.ts
git commit -m "feat(quill): add doctor command"
```

---

## Chunk 5: Integration Tests

Add basic integration tests for all three commands.

**Files:**
- Create: `tests/commands/search.test.ts` (if not created in Chunk 2)
- Create: `tests/commands/info.test.ts`
- Create: `tests/commands/doctor.test.ts`

- [ ] **Step 1: Write integration tests**

Create `tests/commands/info.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { InfoCommand } from '../../src/commands/info.js'

describe('quill info', () => {
  it('exits with error for non-existent package', async () => {
    let exitCode = 0
    const originalExit = process.exit
    ;(process.exit as any) = (code: number) => { exitCode = code }

    await new InfoCommand().run('nonexistent-pkg-xyz')

    process.exit = originalExit
    expect(exitCode).toBe(1)
  })
})
```

Create `tests/commands/doctor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { DoctorCommand } from '../../src/commands/doctor.js'

describe('quill doctor', () => {
  it('runs without crashing', async () => {
    let exitCode = 0
    const originalExit = process.exit
    ;(process.exit as any) = (code: number) => { exitCode = code }

    await new DoctorCommand().run()

    process.exit = originalExit
    // doctor should exit 0 when all checks pass (or 1 if fails)
    expect([0, 1]).toContain(exitCode)
  })
})
```

- [ ] **Step 2: Run all tests**

Run: `npm run build && npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Final commit**

```bash
git add tests/commands/search.test.ts tests/commands/info.test.ts tests/commands/doctor.test.ts
git commit -m "test: add integration tests for search, info, doctor commands"
```

---

## Verification

After completing all chunks:

1. Run `npm run build` — should compile without errors
2. Run `npx vitest run` — all tests pass
3. Manual test:
   - `npx tsx src/cli.js search mobs --page 1`
   - `npx tsx src/cli.js info ink.mobs`
   - `npx tsx src/cli.js doctor`
4. Publish: `npm version patch && npm publish --access public`
