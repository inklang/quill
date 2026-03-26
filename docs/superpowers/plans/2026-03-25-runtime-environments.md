# Runtime Environments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow projects to target specific VMs (e.g., "paper") with packages shipping per-target runtime variants.

**Architecture:**
- Project's `ink-package.toml` gets a `target` field (e.g., `target = "paper"`)
- Registry packages store target-specific artifacts in subfolders (e.g., `paper/ink-manifest.json`)
- `quill add/install` installs only the variant matching project target
- `quill build` reads each package's `ink-manifest.json` from its target subfolder and copies runtime artifacts to `dist/`
- Quill has built-in knowledge of known targets (currently only `"paper"` = JVM/gradle)

**Tech Stack:** TypeScript, Node.js, tar.gz archives

---

## File Structure

### Files Modified

| File | Change |
|------|--------|
| `src/model/manifest.ts` | Add `target?: string` to `PackageManifest` |
| `src/util/toml.ts` | Parse `target` from `[package]` section |
| `src/registry/client.ts` | Add `targets?: string[]` to `RegistryPackageVersion`; update `parseIndex` |
| `src/commands/add.ts` | Target validation before download; extract only matching target subfolder |
| `src/commands/install.ts` | Same target validation as add |
| `src/commands/ink-build.ts` | Write project `target` to ink-manifest.json |
| `src/commands/run.ts` | Update `deployGrammarJars` to read from target subfolder |
| `src/cli.ts` | No changes needed |

### Package Directory Structure (after install)

```
packages/ink.mobs/              # no target folder at root
├── ink-package.toml
└── paper/
    ├── ink-manifest.json       # has "target": "paper"
    ├── grammar.ir.json
    └── mobs-runtime.jar
```

### Project ink-manifest.json (after build)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "target": "paper",
  "grammar": "grammar.ir.json",
  "runtime": { "jar": "mobs-runtime.jar", "entry": "org.ink.mobs.MobsRuntime" },
  "scripts": ["main.inkc"]
}
```

---

## Chunk 1: Model and TOML Parsing

### Files:
- Modify: `src/model/manifest.ts:17-27`
- Modify: `src/util/toml.ts:1-39`

---

### Task 1: Add `target` field to `PackageManifest`

**Files:**
- Modify: `src/model/manifest.ts:17-27`

- [ ] **Step 1: Write the failing test**

```typescript
// In tests/commands/ink-build-runtime.test.ts, add to existing test:
it('writes target field to ink-manifest.json when target is set', () => {
  // This requires a fixture with target = "paper" in ink-package.toml
  // For now, add a new test in a new file:
})
```

Create `tests/model/manifest.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { PackageManifest } from '../../src/model/manifest'

describe('PackageManifest', () => {
  it('has optional target field', () => {
    const manifest: PackageManifest = {
      name: 'test',
      version: '1.0.0',
      main: 'mod',
      dependencies: {},
      target: 'paper',
    }
    expect(manifest.target).toBe('paper')
  })

  it('target is optional', () => {
    const manifest: PackageManifest = {
      name: 'test',
      version: '1.0.0',
      main: 'mod',
      dependencies: {},
    }
    expect(manifest.target).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/model/manifest.test.ts`
Expected: FAIL — `target` doesn't exist on `PackageManifest`

- [ ] **Step 3: Add `target` field to PackageManifest**

In `src/model/manifest.ts`, add `target?: string` to `PackageManifest` interface (after line 23):

```typescript
export interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  dependencies: Record<string, string>;
  target?: string;  // <-- ADD THIS
  grammar?: GrammarConfig;
  runtime?: RuntimeConfig;
  server?: ServerConfig;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/model/manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/model/manifest.ts tests/model/manifest.test.ts
git commit -m "feat(model): add target field to PackageManifest

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Parse `target` from `[package]` section in TOML

**Files:**
- Modify: `src/util/toml.ts:7-39`

- [ ] **Step 1: Write the failing test**

Create `tests/util/toml.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { TomlParser } from '../../src/util/toml'
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs'
import { join } from 'path'
import os from 'os'

describe('TomlParser', () => {
  it('parses target from [package] section', () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'quill-test-'))
    const tomlPath = join(tmpDir, 'ink-package.toml')
    writeFileSync(tomlPath, `
[package]
name = "my-plugin"
version = "1.0.0"
target = "paper"

[grammar]
entry = "src/grammar.ts"
output = "dist/grammar.ir.json"
`)
    try {
      const manifest = TomlParser.read(tomlPath)
      expect(manifest.target).toBe('paper')
    } finally {
      unlinkSync(tomlPath)
    }
  })

  it('target is undefined when not specified', () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'quill-test-'))
    const tomlPath = join(tmpDir, 'ink-package.toml')
    writeFileSync(tomlPath, `
[package]
name = "my-plugin"
version = "1.0.0"
`)
    try {
      const manifest = TomlParser.read(tomlPath)
      expect(manifest.target).toBeUndefined()
    } finally {
      unlinkSync(tomlPath)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/util/toml.test.ts`
Expected: FAIL — `target` not parsed

- [ ] **Step 3: Parse target in TomlParser.read()**

In `src/util/toml.ts`, after line 22, add `target: pkg.target`:

```typescript
return {
  name: pkg.name,
  version: pkg.version ?? '0.0.0',
  description: pkg.description,
  author: pkg.author,
  main: pkg.main ?? pkg.entry ?? 'main',
  target: pkg.target,  // <-- ADD THIS
  dependencies: (data.dependencies as Record<string, string>) ?? {},
  // ... rest unchanged
}
```

Also update `TomlParser.write()` to write the target field when present:

```typescript
static write(manifest: PackageManifest): string {
  const data: Record<string, unknown> = {
    package: {
      name: manifest.name,
      version: manifest.version,
      main: manifest.main,
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.author ? { author: manifest.author } : {}),
      ...(manifest.target ? { target: manifest.target } : {}),  // <-- ADD THIS
    },
    // ... rest unchanged
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/util/toml.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/util/toml.ts tests/util/toml.test.ts
git commit -m "feat(toml): parse target field from [package] section

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Registry Client — Add `targets` Field

### Files:
- Modify: `src/registry/client.ts:7-14`, `src/registry/client.ts:66-80`

---

### Task 3: Add `targets` to `RegistryPackageVersion` and parse from index

**Files:**
- Modify: `src/registry/client.ts:7-14`, `src/registry/client.ts:66-80`

- [ ] **Step 1: Write the failing test**

Create `tests/registry/client.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { RegistryClient } from '../../src/registry/client'

describe('RegistryClient', () => {
  describe('parseIndex', () => {
    it('parses targets field from package version', () => {
      const client = new RegistryClient()
      const json = JSON.stringify({
        packages: {
          'ink.mobs': {
            '1.0.0': {
              url: 'https://example.com/ink.mobs-1.0.0.tar.gz',
              dependencies: {},
              targets: ['paper', 'wasm'],
            }
          }
        }
      })
      const index = client.parseIndex(json)
      const pkg = (index as any).get('ink.mobs')
      expect(pkg).toBeDefined()
      const ver = pkg.versions.get('1.0.0')
      expect(ver.targets).toEqual(['paper', 'wasm'])
    })

    it('targets is undefined when not present', () => {
      const client = new RegistryClient()
      const json = JSON.stringify({
        packages: {
          'ink.mobs': {
            '1.0.0': {
              url: 'https://example.com/ink.mobs-1.0.0.tar.gz',
              dependencies: {},
            }
          }
        }
      })
      const index = client.parseIndex(json)
      const pkg = (index as any).get('ink.mobs')
      const ver = pkg.versions.get('1.0.0')
      expect(ver.targets).toBeUndefined()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/registry/client.test.ts`
Expected: FAIL — `targets` not a property of `RegistryPackageVersion`

- [ ] **Step 3: Add `targets` to RegistryPackageVersion constructor**

In `src/registry/client.ts`, update the constructor to accept and store `targets`:

```typescript
export class RegistryPackageVersion {
  constructor(
    public readonly version: string,
    public readonly url: string,
    public readonly dependencies: Record<string, string>,
    public readonly description?: string,
    public readonly homepage?: string,
    public readonly targets?: string[],  // <-- ADD THIS
  ) {}
}
```

And update `parseIndex` to pass `targets`:

```typescript
versionMap.set(verStr, new RegistryPackageVersion(
  verStr,
  verData.url ?? '',
  verData.dependencies ?? {},
  verData.description,
  verData.homepage,
  verData.targets,  // <-- ADD THIS
))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/registry/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/registry/client.ts tests/registry/client.test.ts
git commit -m "feat(registry): parse targets field from package index

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: Add/Install — Target Validation and Filtering

### Files:
- Modify: `src/commands/add.ts:1-59`
- Modify: `src/commands/install.ts:1-55`

---

### Task 4: Add target validation to `AddCommand`

**Files:**
- Modify: `src/commands/add.ts:1-59`

- [ ] **Step 1: Write the failing test**

Create `tests/commands/add-target.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { RegistryPackageVersion } from '../../src/registry/client'

describe('target validation logic', () => {
  // Test the validation logic in isolation — constructs a RegistryPackageVersion
  // (which now has targets field from Task 3) and verifies target mismatch is detected

  it('detects when package does not support project target', () => {
    const projectTarget = 'paper'
    const pkgVersion = new RegistryPackageVersion(
      '1.0.0',
      'https://example.com/pkg.tar.gz',
      {},
      undefined,  // description
      undefined,  // homepage
      ['wasm', 'node']  // targets — no "paper"
    )

    // Validation: projectTarget && pkgVersion.targets && !pkgVersion.targets.includes(projectTarget)
    const hasValidTarget = projectTarget && pkgVersion.targets && pkgVersion.targets.includes(projectTarget)
    expect(hasValidTarget).toBe(false)
  })

  it('passes when package supports project target', () => {
    const projectTarget = 'paper'
    const pkgVersion = new RegistryPackageVersion(
      '1.0.0',
      'https://example.com/pkg.tar.gz',
      {},
      undefined,
      undefined,
      ['paper', 'wasm']
    )

    const hasValidTarget = projectTarget && pkgVersion.targets && pkgVersion.targets.includes(projectTarget)
    expect(hasValidTarget).toBe(true)
  })

  it('passes when package has no targets field (backward compat for existing packages)', () => {
    const projectTarget = 'paper'
    const pkgVersion = new RegistryPackageVersion(
      '1.0.0',
      'https://example.com/pkg.tar.gz',
      {}
    )

    // Without targets field, validation is skipped (existing packages pre-date this feature)
    expect(pkgVersion.targets).toBeUndefined()
    // Validation should be skipped (no error thrown)
    const hasValidTarget = projectTarget && pkgVersion.targets && pkgVersion.targets.includes(projectTarget)
    expect(hasValidTarget).toBe(false)  // Falsy means validation is skipped
  })
})
```

- [ ] **Step 2: Verify test fails before implementation**

Run: `npx vitest tests/commands/add-target.test.ts`
Expected: FAIL — `targets` parameter doesn't exist on `RegistryPackageVersion` constructor yet (we add it in Task 3)

- [ ] **Step 3: Add target validation to AddCommand**

In `src/commands/add.ts`, after line 34 (after `findBestMatch`):

```typescript
if (!pkgVersion) {
  console.log(`No version of ${pkgName} satisfies ${version ?? 'any version'}`);
  return;
}

// Target validation
const projectTarget = manifest.target;
if (projectTarget && pkgVersion.targets && !pkgVersion.targets.includes(projectTarget)) {
  console.error(`Error: Package ${pkgName}@${pkgVersion.version} does not support target "${projectTarget}".`);
  console.error(`       Available targets: ${pkgVersion.targets.join(', ')}`);
  return;
}
```

Also add `target` to the manifest fallback on line 20:
```typescript
: { name: path.basename(this.projectDir), version: '0.1.0', main: 'main', dependencies: {}, target: undefined };
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to our changes

- [ ] **Step 5: Add target-specific subfolder extraction**

After downloading the tarball (line 50) but before `extractTarGz`, add logic to extract only the matching target subfolder:

```typescript
const cacheDir = path.join(this.projectDir, '.quill-cache');
FileUtils.ensureDir(cacheDir);
const tarball = path.join(cacheDir, `${pkgName.replace('/', '-')}-${pkgVersion.version}.tar.gz`);

await FileUtils.downloadFile(pkgVersion.url, tarball);

// Extract only the matching target subfolder
const extractDir = path.join(cacheDir, `extract-${pkgName.replace('/', '-')}-${pkgVersion.version}`);
await FileUtils.extractTarGz(tarball, extractDir);

// Find the target subfolder by reading ink-manifest.json from each subdirectory
const entries = fs.readdirSync(extractDir);
let targetDir: string | null = null;
for (const entry of entries) {
  const manifestPath = path.join(extractDir, entry, 'ink-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.target === projectTarget) {
      targetDir = entry;
      break;
    }
  }
}

if (!targetDir) {
  console.error(`Error: Could not find variant for target "${projectTarget}" in package tarball.`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  return;
}

// Copy only the matching target subfolder contents to packages dir
const srcDir = path.join(extractDir, targetDir);
FileUtils.ensureDir(pkgDir);
for (const file of fs.readdirSync(srcDir)) {
  const srcFile = path.join(srcDir, file);
  const destFile = path.join(pkgDir, file);
  if (fs.statSync(srcFile).isDirectory()) {
    FileUtils.ensureDir(destFile);
    // Copy directory contents recursively
    copyDir(srcFile, destFile);
  } else {
    fs.copyFileSync(srcFile, destFile);
  }
}
fs.rmSync(extractDir, { recursive: true, force: true });
```

Note: This replaces the original `await FileUtils.extractTarGz(tarball, pkgDir);` line. You will need to add a helper `copyDir` function or use `fs.cpSync` (Node 16+) to copy directories recursively.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/commands/add.ts
git commit -m "feat(add): extract only matching target subfolder from package tarball

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Add target filtering to `InstallCommand`

**Files:**
- Modify: `src/commands/install.ts:1-55`

- [ ] **Step 1: Add target validation to InstallCommand**

Same validation block as Task 4, Step 3. In `src/commands/install.ts`, insert after the `findBestMatch` call (around line 28):

```typescript
// Target validation (same pattern as AddCommand)
const projectTarget = manifest.target;
if (projectTarget && pkgVersion.targets && !pkgVersion.targets.includes(projectTarget)) {
  console.error(`Error: Package ${depName}@${pkgVersion.version} does not support target "${projectTarget}".`);
  console.error(`       Available targets: ${pkgVersion.targets.join(', ')}`);
  return;
}
```

- [ ] **Step 2: Add target-specific subfolder extraction**

After downloading the tarball but before `extractTarGz` (same pattern as Task 4, Step 5):

```typescript
// Extract only the matching target subfolder
const extractDir = path.join(cacheDir, `extract-${depName.replace('/', '-')}-${pkgVersion.version}`);
await FileUtils.extractTarGz(tarball, extractDir);

// Find the target subfolder
const entries = fs.readdirSync(extractDir);
let targetDir: string | null = null;
for (const entry of entries) {
  const manifestPath = path.join(extractDir, entry, 'ink-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const pkgManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (pkgManifest.target === projectTarget) {
      targetDir = entry;
      break;
    }
  }
}

if (!targetDir) {
  console.error(`Error: Could not find variant for target "${projectTarget}" in package tarball.`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  return;
}

// Copy only the matching target subfolder contents to packages dir
const srcDir = path.join(extractDir, targetDir);
FileUtils.ensureDir(pkgDir);
for (const file of fs.readdirSync(srcDir)) {
  const srcFile = path.join(srcDir, file);
  const destFile = path.join(pkgDir, file);
  if (fs.statSync(srcFile).isDirectory()) {
    FileUtils.ensureDir(destFile);
    copyDir(srcFile, destFile);
  } else {
    fs.copyFileSync(srcFile, destFile);
  }
}
fs.rmSync(extractDir, { recursive: true, force: true });
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/install.ts
git commit -m "feat(install): extract only matching target subfolder from package tarball

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: Build — Write Project Target and Copy Package Runtime Artifacts

### Files:
- Modify: `src/commands/ink-build.ts`
- Modify: `src/commands/run.ts`

---

### Task 6: Write project `target` to `ink-manifest.json`

**Files:**
- Modify: `src/commands/ink-build.ts:23-26`

- [ ] **Step 1: Write the failing test**

In `tests/commands/ink-build-runtime.test.ts`, add a new test using a fixture with `target` set:

First create fixture `tests/fixtures/runtime-project/ink-package.toml` already exists with no target. Let's add a new fixture or modify the existing test to verify the target field is written.

Actually, the runtime-project fixture already exists. We need to:
1. Add `target = "paper"` to that fixture
2. Add a test that verifies `ink-manifest.json` includes the `target` field

```typescript
it('writes target to ink-manifest.json when set in ink-package.toml', () => {
  // Fixture already has target = "paper" in ink-package.toml
  execSync(`npx tsx ${CLI} build`, { cwd: RUNTIME_FIXTURE, encoding: 'utf8' })
  const manifest = JSON.parse(readFileSync(join(RUNTIME_FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
  expect(manifest.target).toBe('paper')
})
```

- [ ] **Step 2: Add `target` to inkManifest in ink-build.ts**

In `src/commands/ink-build.ts`, after line 26 (after `version`):

```typescript
const inkManifest: Record<string, unknown> = {
  name: manifest.name,
  version: manifest.version,
  target: manifest.target,  // <-- ADD THIS
}
```

- [ ] **Step 3: Add target to runtime-project fixture**

In `tests/fixtures/runtime-project/ink-package.toml`, add `target = "paper"` to the `[package]` section.

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest tests/commands/ink-build-runtime.test.ts`
Expected: The new test passes

- [ ] **Step 5: Commit**

```bash
git add src/commands/ink-build.ts tests/commands/ink-build-runtime.test.ts tests/fixtures/runtime-project/ink-package.toml
git commit -m "feat(build): write project target to ink-manifest.json

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Build — Copy package runtime artifacts from target subfolder

**Files:**
- Modify: `src/commands/ink-build.ts`
- Modify: `src/commands/run.ts`
- Create: `tests/commands/run-deploy.test.ts`

**Architecture decision:** Per the spec, "Copy runtime artifacts to `dist/`". Package dependency JARs are copied to `dist/` alongside the project's own build output. Then `deployGrammarJars` reads from `dist/` (consistent with `deployScripts` which also reads from `dist/`). This avoids duplicating paths.

- [ ] **Step 1: Write the failing test**

Create `tests/commands/run-deploy.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { deployGrammarJars } from '../../src/commands/run'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import os from 'os'

describe('deployGrammarJars', () => {
  const tmpDir = join(os.tmpdir(), 'quill-deploy-test')
  const serverDir = join(tmpDir, 'server')
  const projectDir = join(tmpDir, 'project')

  beforeEach(() => {
    mkdirSync(join(serverDir, 'plugins', 'Ink', 'plugins'), { recursive: true })
    mkdirSync(join(projectDir, 'dist'), { recursive: true })
    writeFileSync(join(projectDir, 'dist', 'mobs-runtime.jar'), 'fake-jar')
    writeFileSync(join(projectDir, 'dist', 'grammar.ir.json'), '{}')  // not a JAR
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('copies JARs from dist/ to server plugins dir', () => {
    deployGrammarJars(serverDir, projectDir, 'paper')
    expect(existsSync(join(serverDir, 'plugins', 'Ink', 'plugins', 'mobs-runtime.jar'))).toBe(true)
  })

  it('skips non-JAR files in dist/', () => {
    deployGrammarJars(serverDir, projectDir, 'paper')
    const pluginFiles = readdirSync(join(serverDir, 'plugins', 'Ink', 'plugins'))
    expect(pluginFiles).toEqual(['mobs-runtime.jar'])
  })
})
```

- [ ] **Step 2: Add distDir property to InkBuildCommand**

In `src/commands/ink-build.ts`, add `private distDir: string` as a class property and set it in `run()`:

```typescript
export class InkBuildCommand {
  private distDir: string  // <-- ADD

  constructor(private projectDir: string) {}

  async run(opts: { full?: boolean } = {}): Promise<void> {
    this.distDir = join(this.projectDir, 'dist')  // <-- SET
    mkdirSync(this.distDir, { recursive: true })
    // ... rest of run() ...
  }
}
```

- [ ] **Step 3: Add copyPackageArtifacts method to InkBuildCommand**

Add this method to `InkBuildCommand`:

```typescript
/**
 * Copy runtime artifacts from installed packages matching the project target
 * into the project's dist/ directory.
 */
private copyPackageArtifacts(target: string): void {
  const packagesDir = join(this.projectDir, 'packages')
  if (!existsSync(packagesDir)) return

  for (const pkgName of readdirSync(packagesDir)) {
    const pkgTargetDir = join(packagesDir, pkgName, target)
    const manifestPath = join(pkgTargetDir, 'ink-manifest.json')

    if (!existsSync(manifestPath)) {
      console.error(`Error: Package ${pkgName} has no variant for target "${target}".`)
      process.exit(1)
    }

    let pkgManifest: any
    try {
      pkgManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      console.error(`Error: Invalid ink-manifest.json in package ${pkgName}`)
      process.exit(1)
    }

    if (pkgManifest.target !== target) {
      console.error(`Error: Package ${pkgName} is installed for target "${pkgManifest.target}" but project targets "${target}".`)
      console.error(`       Run quill reinstall to resolve.`)
      process.exit(1)
    }

    // Copy runtime JAR if present
    if (pkgManifest.runtime?.jar) {
      const srcJar = join(pkgTargetDir, pkgManifest.runtime.jar)
      if (existsSync(srcJar)) {
        copyFileSync(srcJar, join(this.distDir, pkgManifest.runtime.jar))
      }
    }
  }
}
```

And call it in `run()` after the runtime build section (after line 107, before the script compilation):

```typescript
// Copy artifacts from installed packages matching project target
if (manifest.target) {
  this.copyPackageArtifacts(manifest.target)
}
```

- [ ] **Step 4: Update deployGrammarJars in run.ts to read from dist/**

Update `deployGrammarJars` to read JARs from `dist/` instead of `packages/*/dist/`. The signature also gains a `target` parameter (for consistency with other deploy functions) but the source is `dist/`:

```typescript
export function deployGrammarJars(serverDir: string, projectDir: string, target: string): void {
  const targetDir = join(serverDir, 'plugins', 'Ink', 'plugins')
  mkdirSync(targetDir, { recursive: true })

  const distDir = join(projectDir, 'dist')
  if (!existsSync(distDir)) return

  // Read JARs from dist/ (package artifacts were copied there by ink-build)
  for (const jar of readdirSync(distDir).filter(f => f.endsWith('.jar'))) {
    copyFileSync(join(distDir, jar), join(targetDir, jar))
  }
}
```

Then update the wrapper method in `RunCommand` to pass the target:

```typescript
private deployGrammarJars(target: string): void {
  deployGrammarJars(this.serverDir, this.projectDir, target)
}
```

And update both call sites in `RunCommand.run()`:

```typescript
// In deployScripts() call site:
this.deployGrammarJars(this.manifest.target ?? 'paper')

// In redeploy() function:
this.deployGrammarJars(this.manifest.target ?? 'paper')
```

Note: `target` is passed for API consistency but the actual JARs come from `dist/`.

- [ ] **Step 5: Run tests to verify**

Run: `npx vitest tests/commands/run-deploy.test.ts`
Expected: PASS (once implementation is complete)

- [ ] **Step 6: Commit**

```bash
git add src/commands/ink-build.ts src/commands/run.ts tests/commands/run-deploy.test.ts
git commit -m "feat(build): copy package runtime artifacts from target subfolders to dist/

- InkBuildCommand.copyPackageArtifacts copies installed package JARs to dist/
- deployGrammarJars reads JARs from dist/ (matching deployScripts path)
- project target is validated but artifacts are read from dist/ output dir

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: Integration Tests

### Files:
- Create: `tests/fixtures/multi-target-project/` fixture
- Modify: `tests/commands/ink-build.test.ts`

---

### Task 8: Create multi-target test fixture and integration test

**Files:**
- Create: `tests/fixtures/multi-target-project/ink-package.toml`
- Create: `tests/fixtures/multi-target-project/packages/ink.mobs/paper/ink-manifest.json`
- Create: `tests/fixtures/multi-target-project/packages/ink.mobs/paper/mobs-runtime.jar`
- Modify: `tests/commands/ink-build.test.ts`

- [ ] **Step 1: Create fixture directory structure**

```
tests/fixtures/multi-target-project/
├── ink-package.toml          # name = "my-plugin", target = "paper"
├── packages/
│   └── ink.mobs/
│       └── paper/
│           ├── ink-manifest.json   # target: "paper", runtime: { jar: "mobs-runtime.jar" }
│           └── mobs-runtime.jar    # dummy file
└── scripts/
    └── main.ink
```

Create `tests/fixtures/multi-target-project/ink-package.toml`:
```toml
[package]
name = "my-plugin"
version = "1.0.0"
target = "paper"

[grammar]
entry = "src/grammar.ts"
output = "dist/grammar.ir.json"

[dependencies]
ink.mobs = "^1.0.0"
```

Create `tests/fixtures/multi-target-project/packages/ink.mobs/paper/ink-manifest.json`:
```json
{
  "name": "ink.mobs",
  "version": "1.0.0",
  "target": "paper",
  "grammar": "grammar.ir.json",
  "runtime": {
    "jar": "mobs-runtime.jar",
    "entry": "org.ink.mobs.MobsRuntime"
  }
}
```

Create a dummy JAR: just a file named `mobs-runtime.jar` with any content.

- [ ] **Step 2: Write integration test**

Add to `tests/commands/ink-build.test.ts` or create new `tests/commands/ink-build-multi-target.test.ts`:

```typescript
import { execSync } from 'child_process'
import { readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, beforeEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const FIXTURE = join(__dirname, '../fixtures/multi-target-project')

describe('ink build with target-specific packages', () => {
  beforeEach(() => {
    try { rmSync(join(FIXTURE, 'dist'), { recursive: true }) } catch {}
    mkdirSync(join(FIXTURE, 'dist'), { recursive: true })
  })

  it('copies package runtime artifacts from matching target subfolder', () => {
    const result = execSync(`npx tsx ${CLI} build`, {
      cwd: FIXTURE,
      encoding: 'utf8',
    })

    // Project ink-manifest.json should have target = "paper"
    const manifest = JSON.parse(readFileSync(join(FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.target).toBe('paper')

    // Package runtime JAR should be copied to dist
    expect(existsSync(join(FIXTURE, 'dist/mobs-runtime.jar'))).toBe(true)
  })

  it('fails when installed package has no variant for project target', () => {
    // Setup: remove the paper variant so only wasm exists
    const wasmDir = join(FIXTURE, 'packages/ink.mobs/wasm')
    mkdirSync(wasmDir, { recursive: true })
    writeFileSync(join(wasmDir, 'ink-manifest.json'), JSON.stringify({
      name: 'ink.mobs',
      target: 'wasm',
      runtime: { jar: 'mobs-runtime.wasm' }
    }))
    rmSync(join(FIXTURE, 'packages/ink.mobs/paper'), { recursive: true })

    try {
      execSync(`npx tsx ${CLI} build`, { cwd: FIXTURE, encoding: 'utf8', stdio: 'pipe' })
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e.stderr.toString()).toContain('no variant for target "paper"')
    } finally {
      // Restore paper variant
      mkdirSync(join(FIXTURE, 'packages/ink.mobs/paper'), { recursive: true })
      rmSync(wasmDir, { recursive: true })
    }
  })
})
```

- [ ] **Step 3: Run integration test**

Run: `npx vitest tests/commands/ink-build-multi-target.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/multi-target-project/ tests/commands/ink-build-multi-target.test.ts
git commit -m "test: add multi-target build fixture and integration test

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary of Commits

| # | Message |
|---|---------|
| 1 | feat(model): add target field to PackageManifest |
| 2 | feat(toml): parse target field from [package] section |
| 3 | feat(registry): parse targets field from package index |
| 4 | feat(add): validate package target matches project target |
| 5 | feat(install): validate package target matches project target |
| 6 | feat(build): write project target to ink-manifest.json |
| 7 | feat(build): copy package runtime artifacts from target subfolders to dist/ |
| 8 | test: add multi-target build fixture and integration test |
