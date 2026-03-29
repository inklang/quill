# Transitive Dependency Resolution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `quill add` and `quill install` resolve and install transitive dependencies, with lock file graph tracking.

**Architecture:** Add a `resolveTransitive` function in a new `src/resolve.ts` module that takes the registry index + root deps and returns a flat resolved set. Both `add.ts` and `install.ts` call it. `lockfile.ts` gains a `dependencies` field on entries. The download/extract logic in both commands is unified to handle the full resolved set.

**Tech Stack:** TypeScript, Vitest, existing quill modules (Semver, SemverRange, RegistryClient)

---

## Chunk 1: Lock file format + resolver

### Task 1: Update LockfileEntry with dependencies array

**Files:**
- Modify: `src/lockfile.ts:3-8`
- Modify: `tests/lockfile.test.ts` (extend existing — do NOT overwrite)

- [ ] **Step 1: Add new tests to the existing `tests/lockfile.test.ts`**

Add these tests inside the existing `describe('Lockfile', ...)` block, after the existing tests:

```typescript
it('writes and reads entries with dependencies array', () => {
  const filePath = path.join(tmpDir, 'quill-lockfile-deps-test.lock');
  const entry = new LockfileEntry('1.2.0', 'https://example.com/pkg.tar.gz', ['dep-a@1.0.0', 'dep-b@2.0.0'])
  const lockfile = new Lockfile('https://registry.example.com', { 'pkg@1.2.0': entry })
  lockfile.write(filePath)

  const read = Lockfile.read(filePath)
  expect(read.packages['pkg@1.2.0'].version).toBe('1.2.0')
  expect(read.packages['pkg@1.2.0'].resolutionSource).toBe('https://example.com/pkg.tar.gz')
  expect(read.packages['pkg@1.2.0'].dependencies).toEqual(['dep-a@1.0.0', 'dep-b@2.0.0'])

  fs.unlinkSync(filePath)
})

it('defaults dependencies to empty array when not present in file', () => {
  const filePath = path.join(tmpDir, 'quill-lockfile-v1-test.lock');
  // Write a v1 lockfile (no dependencies field)
  const v1Content = JSON.stringify({
    version: 1,
    registry: 'https://registry.example.com',
    packages: {
      'pkg@1.0.0': { version: '1.0.0', resolutionSource: 'https://example.com/pkg.tar.gz' }
    }
  }, null, 2)
  fs.writeFileSync(filePath, v1Content)

  const read = Lockfile.read(filePath)
  expect(read.packages['pkg@1.0.0'].dependencies).toEqual([])

  fs.unlinkSync(filePath)
})

it('writes version 2 format', () => {
  const filePath = path.join(tmpDir, 'quill-lockfile-v2-test.lock');
  const entry = new LockfileEntry('1.0.0', 'https://example.com/pkg.tar.gz')
  const lockfile = new Lockfile('https://registry.example.com', { 'pkg@1.0.0': entry })
  lockfile.write(filePath)

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  expect(raw.version).toBe(2)

  fs.unlinkSync(filePath)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lockfile.test.ts`
Expected: FAIL — `LockfileEntry` constructor doesn't accept 3 args, `dependencies` property missing

- [ ] **Step 3: Implement LockfileEntry with dependencies**

Update `src/lockfile.ts`:

```typescript
export class LockfileEntry {
  constructor(
    public readonly version: string,
    public readonly resolutionSource: string,
    public readonly dependencies: string[] = []
  ) {}
}

// In Lockfile.read — update the parsing:
packages[key] = new LockfileEntry(val.version, val.resolutionSource, val.dependencies ?? []);

// In Lockfile.write — update the serialization:
packages[key] = {
  version: entry.version,
  resolutionSource: entry.resolutionSource,
  dependencies: entry.dependencies,
};

// Change version number from 1 to 2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lockfile.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lockfile.ts tests/lockfile.test.ts
git commit -m "feat: add dependencies field to LockfileEntry (v2 format)"
```

---

### Task 2: Create the transitive resolver

**Files:**
- Create: `src/resolve.ts`
- Create: `tests/resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/resolve.test.ts
import { describe, it, expect } from 'vitest'
import { resolveTransitive } from '../src/resolve.js'
import { RegistryClient, RegistryPackage, RegistryPackageVersion } from '../src/registry/client.js'

// Helper to build a registry index from package definitions.
// Uses RegistryClient.parseIndex to produce a realistic proxy.
function buildIndex(packages: { name: string; version: string; deps?: Record<string, string> }[]): object {
  const client = new RegistryClient('http://localhost:0')
  const indexData: any = { packages: {} }
  for (const pkg of packages) {
    if (!indexData.packages[pkg.name]) indexData.packages[pkg.name] = {}
    indexData.packages[pkg.name][pkg.version] = {
      url: `http://localhost/tarballs/${pkg.name}-${pkg.version}.tar.gz`,
      dependencies: pkg.deps ?? {},
      description: `desc-${pkg.name}`,
      checksum: `sha256:${pkg.name}-${pkg.version}`,
    }
  }
  return client.parseIndex(JSON.stringify(indexData))
}

describe('resolveTransitive', () => {
  it('resolves a single package with no dependencies', () => {
    const index = buildIndex([
      { name: 'ink.utils', version: '1.0.0' }
    ])
    const result = resolveTransitive(index, { 'ink.utils': '^1.0.0' })
    expect(result.size).toBe(1)
    expect(result.get('ink.utils')!.version).toBe('1.0.0')
  })

  it('resolves transitive dependencies', () => {
    const index = buildIndex([
      { name: 'ink.mobs', version: '1.0.0', deps: { 'ink.utils': '^1.0.0' } },
      { name: 'ink.utils', version: '1.0.0' },
      { name: 'ink.utils', version: '1.5.0' },
    ])
    const result = resolveTransitive(index, { 'ink.mobs': '^1.0.0' })
    expect(result.size).toBe(2)
    expect(result.get('ink.mobs')!.version).toBe('1.0.0')
    expect(result.get('ink.utils')!.version).toBe('1.5.0')  // highest compatible
  })

  it('resolves diamond dependencies to highest compatible version', () => {
    const index = buildIndex([
      { name: 'ink.mobs', version: '1.0.0', deps: { 'ink.utils': '^1.0.0' } },
      { name: 'ink.items', version: '1.0.0', deps: { 'ink.utils': '^1.2.0' } },
      { name: 'ink.utils', version: '1.0.0' },
      { name: 'ink.utils', version: '1.2.0' },
      { name: 'ink.utils', version: '1.5.0' },
    ])
    const result = resolveTransitive(index, { 'ink.mobs': '^1.0.0', 'ink.items': '^1.0.0' })
    expect(result.size).toBe(3)
    expect(result.get('ink.utils')!.version).toBe('1.5.0')
  })

  it('errors on incompatible version ranges', () => {
    const index = buildIndex([
      { name: 'ink.mobs', version: '1.0.0', deps: { 'ink.utils': '^1.0.0' } },
      { name: 'ink.items', version: '1.0.0', deps: { 'ink.utils': '^2.0.0' } },
      { name: 'ink.utils', version: '1.5.0' },
      { name: 'ink.utils', version: '2.0.0' },
    ])
    expect(() => resolveTransitive(index, { 'ink.mobs': '^1.0.0', 'ink.items': '^1.0.0' }))
      .toThrow(/ink\.utils/)
  })

  it('handles three levels of transitive deps', () => {
    const index = buildIndex([
      { name: 'a', version: '1.0.0', deps: { 'b': '^1.0.0' } },
      { name: 'b', version: '1.0.0', deps: { 'c': '^1.0.0' } },
      { name: 'c', version: '1.0.0' },
    ])
    const result = resolveTransitive(index, { 'a': '^1.0.0' })
    expect(result.size).toBe(3)
    expect(result.get('a')!.version).toBe('1.0.0')
    expect(result.get('b')!.version).toBe('1.0.0')
    expect(result.get('c')!.version).toBe('1.0.0')
  })

  it('handles circular dependencies without infinite loop', () => {
    const index = buildIndex([
      { name: 'a', version: '1.0.0', deps: { 'b': '^1.0.0' } },
      { name: 'b', version: '1.0.0', deps: { 'a': '^1.0.0' } },
    ])
    const result = resolveTransitive(index, { 'a': '^1.0.0' })
    expect(result.size).toBe(2)
  })

  it('errors when a dependency is not found in the registry', () => {
    const index = buildIndex([
      { name: 'ink.mobs', version: '1.0.0', deps: { 'ink.missing': '^1.0.0' } },
    ])
    expect(() => resolveTransitive(index, { 'ink.mobs': '^1.0.0' }))
      .toThrow(/ink\.missing/)
  })

  it('handles package with undefined dependencies field', () => {
    // Build index manually — parseIndex always sets deps to {}, but
    // a real RegistryPackageVersion could have undefined deps
    const index = buildIndex([
      { name: 'ink.standalone', version: '1.0.0' }  // no deps key
    ])
    const result = resolveTransitive(index, { 'ink.standalone': '^1.0.0' })
    expect(result.size).toBe(1)
    expect(result.get('ink.standalone')!.depKeys).toEqual([])
  })

  it('records resolved dependency edges (name@resolvedVersion)', () => {
    const index = buildIndex([
      { name: 'ink.mobs', version: '1.0.0', deps: { 'ink.utils': '^1.0.0' } },
      { name: 'ink.utils', version: '1.0.0' },
      { name: 'ink.utils', version: '1.5.0' },
    ])
    const result = resolveTransitive(index, { 'ink.mobs': '^1.0.0' })
    // depKeys should use the RESOLVED version, not the range
    expect(result.get('ink.mobs')!.depKeys).toEqual(['ink.utils@1.5.0'])
    expect(result.get('ink.utils')!.depKeys).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/resolve.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the resolver**

Create `src/resolve.ts`:

```typescript
import { RegistryPackageVersion } from './registry/client.js'
import { Semver } from './model/semver.js'
import { SemverRange } from './model/semver.js'

export interface ResolvedPkg {
  name: string
  version: string
  url: string
  range: string
  targets?: string[]
  checksum?: string
  depKeys: string[]  // "name@resolvedVersion" of direct deps — for lock file graph
}

/**
 * Resolve a set of root dependencies transitively.
 * Returns a flat Map<name, ResolvedPkg> with the full tree.
 * Throws on version conflicts or missing packages.
 */
export function resolveTransitive(
  index: object,
  roots: Record<string, string>,
): Map<string, ResolvedPkg> {
  const resolved = new Map<string, ResolvedPkg>()
  const ranges = new Map<string, string[]>()  // accumulated ranges per package name
  const visiting = new Set<string>()  // cycle detection

  function resolve(name: string, range: string, requiredBy: string): void {
    // Accumulate ranges
    const existing = ranges.get(name) ?? []
    if (existing.includes(range)) return  // already processing this exact range
    ranges.set(name, [...existing, range])

    // Find a version satisfying ALL accumulated ranges
    const allRanges = ranges.get(name)!
    const version = findBestMatchAllRanges(index, name, allRanges)

    if (!version) {
      throw new Error(
        `No version of ${name} satisfies all requirements: ${allRanges.join(', ')} (required by ${requiredBy})`
      )
    }

    // If already resolved to this version, skip (avoid cycles and dupes)
    const existingResolved = resolved.get(name)
    if (existingResolved && existingResolved.version === version.version) return

    // Placeholder — depKeys filled in after recursion
    const entry: ResolvedPkg = {
      name,
      version: version.version,
      url: version.url,
      range: allRanges.join(' && '),
      targets: version.targets,
      checksum: version.checksum,
      depKeys: [],
    }
    resolved.set(name, entry)

    // Cycle detection
    if (visiting.has(name)) return
    visiting.add(name)

    // Recurse into this package's deps
    const deps = version.dependencies ?? {}
    for (const [depName, depRange] of Object.entries(deps)) {
      resolve(depName, depRange, name)
      // After resolve(), the dep is in the resolved map — record the resolved version
      const resolvedDep = resolved.get(depName)
      if (resolvedDep) {
        entry.depKeys.push(`${depName}@${resolvedDep.version}`)
      }
    }

    visiting.delete(name)
  }

  for (const [name, range] of Object.entries(roots)) {
    resolve(name, range, '<root>')
  }

  return resolved
}

function findBestMatchAllRanges(
  index: object,
  pkgName: string,
  ranges: string[],
): RegistryPackageVersion | null {
  let pkg: any
  if (index instanceof Map) {
    pkg = index.get(pkgName)
  } else {
    const getFn = (index as any).get || (index as any).getRegistryPackage
    if (getFn) pkg = getFn(pkgName)
  }
  if (!pkg) return null

  const semverRanges = ranges.map(r => new SemverRange(r))

  let best: { ver: RegistryPackageVersion; parsed: Semver } | null = null
  for (const [verStr, ver] of pkg.versions.entries()) {
    try {
      const parsed = Semver.parse(verStr)
      const matches = semverRanges.every(r => r.matches(parsed))
      if (matches) {
        if (!best || parsed.compareTo(best.parsed) > 0) {
          best = { ver, parsed }
        }
      }
    } catch {}
  }

  return best?.ver ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/resolve.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/resolve.ts tests/resolve.test.ts
git commit -m "feat: add transitive dependency resolver"
```

---

## Chunk 2: Wire resolver into add + install

### Task 3: Update AddCommand to resolve transitively

**Files:**
- Modify: `src/commands/add.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/commands/add-transitive.test.ts`:

```typescript
import { writeFileSync, rmSync, mkdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer, type Server } from 'http'
import { gzipSync } from 'zlib'
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { AddCommand } from '../../src/commands/add.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TMP = join(__dirname, '../fixtures/.tmp-add-transitive-test')

describe('quill add transitive', () => {
  let server: Server
  let registryUrl: string
  let originalEnv: string | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/index.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          packages: {
            'ink.mobs': {
              '1.0.0': {
                url: `${registryUrl}/tarballs/ink.mobs-1.0.0.tar.gz`,
                dependencies: { 'ink.utils': '^1.0.0' },
                description: 'Mob framework',
                checksum: 'sha256:abc123',
              }
            },
            'ink.utils': {
              '1.0.0': {
                url: `${registryUrl}/tarballs/ink.utils-1.0.0.tar.gz`,
                dependencies: {},
                description: 'Utilities',
                checksum: 'sha256:def456',
              },
              '1.5.0': {
                url: `${registryUrl}/tarballs/ink.utils-1.5.0.tar.gz`,
                dependencies: {},
                description: 'Utilities',
                checksum: 'sha256:ghi789',
              }
            }
          }
        }))
      } else if (req.url?.startsWith('/tarballs/')) {
        // Return a minimal valid .tar.gz (empty gzip of empty tar)
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end(gzipSync(Buffer.alloc(0)))
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address() as { port: number }
    registryUrl = `http://127.0.0.1:${addr.port}`
    originalEnv = process.env['LECTERN_REGISTRY']
    process.env['LECTERN_REGISTRY'] = registryUrl
  })

  afterAll(async () => {
    if (originalEnv !== undefined) process.env['LECTERN_REGISTRY'] = originalEnv
    else delete process.env['LECTERN_REGISTRY']
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  afterEach(() => {
    try { rmSync(TMP, { recursive: true }) } catch {}
  })

  it('resolves transitive dependencies when adding a package', async () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'), [
      `[package]`,
      `name = "ink.test"`,
      `version = "0.1.0"`,
      `main = "mod"`,
      ``,
      `[dependencies]`,
    ].join('\n'))

    const logs: string[] = []
    const origLog = console.log
    const origError = console.error
    console.log = (...args: any[]) => logs.push(args.join(' '))
    console.error = (...args: any[]) => logs.push(args.join(' '))
    try {
      const cmd = new AddCommand(TMP)
      await cmd.run('ink.mobs', { force: true })
    } finally {
      console.log = origLog
      console.error = origError
    }

    // Check lock file has both packages
    const lock = JSON.parse(readFileSync(join(TMP, 'quill.lock'), 'utf-8'))
    expect(lock.packages).toHaveProperty('ink.mobs@1.0.0')
    expect(lock.packages).toHaveProperty('ink.utils@1.5.0')
    expect(lock.packages['ink.mobs@1.0.0'].dependencies).toEqual(['ink.utils@1.5.0'])
    expect(lock.packages['ink.utils@1.5.0'].dependencies).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/add-transitive.test.ts`
Expected: FAIL — lock file won't contain `ink.utils` yet

- [ ] **Step 3: Implement transitive resolution in AddCommand**

Modify `src/commands/add.ts`:

1. Import `resolveTransitive, ResolvedPkg` from `../resolve.js`
2. After fetching the index, call `resolveTransitive(index, { [pkgName]: rangeStr })` to get the full resolved set
3. Keep target validation and vulnerability audit for the direct package only
4. Replace single-package download/extract with a loop over the full resolved set:
   - Filter out already-installed packages (by checking `packages/<name>` dir)
   - Download in batches of 3 (same pattern as `install.ts`)
   - For each package: download → verify checksum → extract with target matching
5. Update `ink-package.toml` — only the direct package (unchanged)
6. Update `quill.lock` — write all resolved packages, each with their `depKeys` as the `dependencies` array on `LockfileEntry`
7. `--dry-run` should list all packages in the resolved set, not just the direct one
8. `--verbose` should show each transitive dep's URL and version

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/add-transitive.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/add.ts tests/commands/add-transitive.test.ts
git commit -m "feat: add command now resolves transitive dependencies"
```

---

### Task 4: Update InstallCommand to resolve transitively

**Files:**
- Modify: `src/commands/install.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `tests/commands/add-install.test.ts` — this test needs its own mock server with transitive packages. Add a new `describe` block:

```typescript
describe('quill install transitive', () => {
  const TMP_TRANSITIVE = join(__dirname, '../fixtures/.tmp-install-transitive-test')
  let server: Server
  let registryUrl: string
  let originalEnv: string | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/index.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          packages: {
            'ink.mobs': {
              '1.0.0': {
                url: `${registryUrl}/tarballs/ink.mobs-1.0.0.tar.gz`,
                dependencies: { 'ink.utils': '^1.0.0' },
                description: 'Mob framework',
              }
            },
            'ink.utils': {
              '1.0.0': {
                url: `${registryUrl}/tarballs/ink.utils-1.0.0.tar.gz`,
                dependencies: {},
                description: 'Utilities',
              },
              '1.5.0': {
                url: `${registryUrl}/tarballs/ink.utils-1.5.0.tar.gz`,
                dependencies: {},
                description: 'Utilities',
              }
            }
          }
        }))
      } else if (req.url?.startsWith('/tarballs/')) {
        const { gzipSync } = require('zlib')
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end(gzipSync(Buffer.alloc(0)))
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address() as { port: number }
    registryUrl = `http://127.0.0.1:${addr.port}`
    originalEnv = process.env['LECTERN_REGISTRY']
    process.env['LECTERN_REGISTRY'] = registryUrl
  })

  afterAll(async () => {
    if (originalEnv !== undefined) process.env['LECTERN_REGISTRY'] = originalEnv
    else delete process.env['LECTERN_REGISTRY']
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  afterEach(() => {
    try { rmSync(TMP_TRANSITIVE, { recursive: true }) } catch {}
  })

  it('install resolves transitive dependencies', async () => {
    mkdirSync(TMP_TRANSITIVE, { recursive: true })
    writeFileSync(join(TMP_TRANSITIVE, 'ink-package.toml'), [
      `[package]`,
      `name = "ink.test"`,
      `version = "0.1.0"`,
      `main = "mod"`,
      ``,
      `[dependencies]`,
      `ink.mobs = "^1.0.0"`,
    ].join('\n'))

    const logs: string[] = []
    const origLog = console.log
    const origError = console.error
    console.log = (...args: any[]) => logs.push(args.join(' '))
    console.error = (...args: any[]) => logs.push(args.join(' '))
    try {
      const cmd = new InstallCommand(TMP_TRANSITIVE)
      await cmd.run()
    } finally {
      console.log = origLog
      console.error = origError
    }

    const lock = JSON.parse(readFileSync(join(TMP_TRANSITIVE, 'quill.lock'), 'utf-8'))
    expect(lock.packages).toHaveProperty('ink.mobs@1.0.0')
    expect(lock.packages).toHaveProperty('ink.utils@1.5.0')
    expect(lock.packages['ink.mobs@1.0.0'].dependencies).toEqual(['ink.utils@1.5.0'])
  })
})
```

Note: You'll need to add these imports at the top of `add-install.test.ts` if not already present:
```typescript
import { gzipSync } from 'zlib'
```
And replace the `require('zlib')` inside the server handler with `gzipSync`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/add-install.test.ts`
Expected: FAIL — lock file won't contain transitive deps

- [ ] **Step 3: Implement transitive resolution in InstallCommand**

Modify `src/commands/install.ts`:

1. Import `resolveTransitive, ResolvedPkg` from `../resolve.js`
2. Replace the manual per-dependency resolution loop with `resolveTransitive(index, manifest.dependencies)`
3. Keep the lock-file-preference behavior: before calling `resolveTransitive`, check if locked versions exist. If so, the resolver already handles this by finding the same version via `findBestMatchAllRanges`
4. Convert resolved map entries to the `ResolvedPkg`-style objects the download/extract loop expects
5. The download/extract loop iterates the full resolved set (same batch-of-3 pattern)
6. Lock file writes all packages with `dependencies` arrays from `depKeys`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/add-install.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/install.ts tests/commands/add-install.test.ts
git commit -m "feat: install command now resolves transitive dependencies"
```

---

## Chunk 3: Integration verification

### Task 5: End-to-end verification

**Files:** None new — verification only

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: Compiles without errors

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Verify add --dry-run shows transitive deps**

Run: `node dist/cli.js add ink.mobs --dry-run -v` (in a test project with ink-package.toml)
Expected: Shows both `ink.mobs` and its transitive dependencies

- [ ] **Step 4: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address integration issues in transitive resolution"
```
