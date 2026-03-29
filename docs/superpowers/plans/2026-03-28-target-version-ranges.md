# Target Version Ranges Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-target semver version ranges to ink-package.toml so packages can declare which target platform versions they support, with build-time compatibility checking.

**Architecture:** Add `targetVersion` field to `TargetConfig`, parse/serialize it in the TOML parser, add a compatibility checker module using the `semver` npm package, and wire it into `quill build` and `quill install` via new CLI flags.

**Tech Stack:** TypeScript, `semver` npm package, vitest, existing quill codebase

**Spec:** `docs/superpowers/specs/2026-03-28-target-version-ranges-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/model/manifest.ts` | Modify | Add `targetVersion` to `TargetConfig` |
| `src/util/toml.ts` | Modify | Parse/serialize `target-version` on target configs |
| `src/util/target-version.ts` | Create | Version resolution + compatibility checking logic |
| `src/cli.ts` | Modify | Add `--target-version` flag to `build` and `install` |
| `src/commands/ink-build.ts` | Modify | Wire target version resolution + compatibility check |
| `src/commands/install.ts` | Modify | Wire target version resolution + compatibility check |
| `tests/util/target-version.test.ts` | Create | Tests for version resolution and compatibility checking |
| `tests/util/toml.test.ts` | Modify | Tests for parsing/writing target-version |

---

## Chunk 1: Manifest schema + parser

### Task 1: Add targetVersion to TargetConfig

**Files:**
- Modify: `src/model/manifest.ts:11-16`
- Test: `tests/util/toml.test.ts`

- [ ] **Step 1: Write the failing test for parsing target-version**

Add to end of `tests/util/toml.test.ts` (after the last `describe` block):

```typescript
describe('TomlParser with target-version', () => {
  const tmpDir = os.tmpdir();

  it('parses target-version from [targets] section', () => {
    const content = `
[package]
name = "ink.paper"
version = "0.2.0"

[targets.paper]
entry = "org.inklang.paper.PaperBridge"
jar = "runtime/paper/build/libs/ink-paper-0.2.0.jar"
target-version = ">=1.20.0 <1.23.0"
`;
    const filePath = path.join(tmpDir, 'quill-target-version-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);
    try {
      const manifest = TomlParser.read(filePath);
      expect(manifest.targets).toBeDefined();
      expect(manifest.targets!.paper.targetVersion).toBe('>=1.20.0 <1.23.0');
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('targetVersion is undefined when not specified', () => {
    const content = `
[package]
name = "ink.paper"
version = "0.2.0"

[targets.paper]
entry = "org.inklang.paper.PaperBridge"
`;
    const filePath = path.join(tmpDir, 'quill-no-target-version-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);
    try {
      const manifest = TomlParser.read(filePath);
      expect(manifest.targets!.paper.targetVersion).toBeUndefined();
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('writes target-version to toml', () => {
    const manifest: PackageManifest = {
      name: 'ink.paper',
      version: '0.2.0',
      dependencies: {},
      targets: {
        paper: {
          entry: 'org.inklang.paper.PaperBridge',
          jar: 'runtime/paper.jar',
          targetVersion: '>=1.20.0 <1.23.0',
        },
      },
    };
    const filePath = path.join(tmpDir, 'quill-write-target-version-' + Date.now() + '.toml');
    const tomlString = TomlParser.write(manifest);
    fs.writeFileSync(filePath, tomlString);
    try {
      const written = fs.readFileSync(filePath, 'utf-8');
      expect(written).toContain('target-version = ">=1.20.0 <1.23.0"');
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('write omits target-version when undefined', () => {
    const manifest: PackageManifest = {
      name: 'ink.paper',
      version: '0.2.0',
      dependencies: {},
      targets: {
        paper: {
          entry: 'org.inklang.paper.PaperBridge',
        },
      },
    };
    const filePath = path.join(tmpDir, 'quill-write-no-target-version-' + Date.now() + '.toml');
    const tomlString = TomlParser.write(manifest);
    fs.writeFileSync(filePath, tomlString);
    try {
      const written = fs.readFileSync(filePath, 'utf-8');
      expect(written).not.toContain('target-version');
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('round-trips target-version through parse and write', () => {
    const content = `
[package]
name = "ink.paper"
version = "0.2.0"

[targets.paper]
entry = "org.inklang.paper.PaperBridge"
target-version = ">=1.21.0"
`;
    const readPath = path.join(tmpDir, 'quill-rt-read-' + Date.now() + '.toml');
    const writePath = path.join(tmpDir, 'quill-rt-write-' + Date.now() + '.toml');
    fs.writeFileSync(readPath, content);
    try {
      const manifest = TomlParser.read(readPath);
      const tomlString = TomlParser.write(manifest);
      fs.writeFileSync(writePath, tomlString);
      const reRead = TomlParser.read(writePath);
      expect(reRead.targets!.paper.targetVersion).toBe('>=1.21.0');
      fs.unlinkSync(writePath);
    } finally {
      fs.unlinkSync(readPath);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/util/toml.test.ts`
Expected: FAIL — `targetVersion` is undefined because `TargetConfig` doesn't have the field yet and the parser doesn't extract it.

- [ ] **Step 3: Add targetVersion to TargetConfig interface**

In `src/model/manifest.ts`, modify the `TargetConfig` interface (lines 11-16):

```typescript
export interface TargetConfig {
  entry: string;
  jar?: string;  // For legacy external JAR projects
  jvmArgs?: string[];
  env?: Record<string, string>;
  targetVersion?: string;  // semver range, e.g. ">=1.20.0 <1.23.0"
}
```

- [ ] **Step 4: Parse target-version in TomlParser**

In `src/util/toml.ts`, modify the targets parsing (line 34-39) to extract `target-version`:

Change the map inside `Object.entries(targetsSection).map(...)` from:
```typescript
[name, cfg] => [name, {
  entry: cfg.entry,
  jar: cfg.jar,
  jvmArgs: cfg['jvm-args'],
  env: cfg.env,
}]
```
to:
```typescript
[name, cfg] => [name, {
  entry: cfg.entry,
  jar: cfg.jar,
  jvmArgs: cfg['jvm-args'],
  env: cfg.env,
  targetVersion: cfg['target-version'],
}]
```

- [ ] **Step 5: Serialize target-version in TomlParser.write()**

In `src/util/toml.ts`, modify the targets serialization in `write()` (lines 107-113). Change the object built per target entry from:
```typescript
(data.targets as Record<string, any>)[name] = {
  entry: cfg.entry,
  ...(cfg.jar ? { jar: cfg.jar } : {}),
  ...(cfg.jvmArgs?.length ? { 'jvm-args': cfg.jvmArgs } : {}),
  ...(cfg.env && Object.keys(cfg.env).length ? { env: cfg.env } : {}),
};
```
to:
```typescript
(data.targets as Record<string, any>)[name] = {
  entry: cfg.entry,
  ...(cfg.jar ? { jar: cfg.jar } : {}),
  ...(cfg.jvmArgs?.length ? { 'jvm-args': cfg.jvmArgs } : {}),
  ...(cfg.env && Object.keys(cfg.env).length ? { env: cfg.env } : {}),
  ...(cfg.targetVersion ? { 'target-version': cfg.targetVersion } : {}),
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/util/toml.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: All existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/model/manifest.ts src/util/toml.ts tests/util/toml.test.ts
git commit -m "feat: add targetVersion field to TargetConfig with parse/serialize"
```

---

## Chunk 2: Target version checker module

### Task 2: Install semver and create target-version utility

**Files:**
- Create: `src/util/target-version.ts`
- Create: `tests/util/target-version.test.ts`

- [ ] **Step 1: Install semver package**

Run: `npm install semver && npm install -D @types/semver`

- [ ] **Step 2: Write the failing tests**

Create `tests/util/target-version.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveTargetVersion, checkTargetVersionCompatibility } from '../../src/util/target-version.js';
import type { PackageManifest } from '../../src/model/manifest.js';

describe('resolveTargetVersion', () => {
  it('returns CLI flag version as highest priority', () => {
    const result = resolveTargetVersion({
      cliFlag: '1.21.4',
      buildConfig: '1.20.0',
      serverPaper: '1.22.0',
      activeTarget: 'paper',
    });
    expect(result).toBe('1.21.4');
  });

  it('returns build config version when no CLI flag', () => {
    const result = resolveTargetVersion({
      buildConfig: '1.20.0',
      serverPaper: '1.22.0',
      activeTarget: 'paper',
    });
    expect(result).toBe('1.20.0');
  });

  it('returns server paper version when no CLI flag or build config and target is paper', () => {
    const result = resolveTargetVersion({
      serverPaper: '1.22.0',
      activeTarget: 'paper',
    });
    expect(result).toBe('1.22.0');
  });

  it('returns null when no sources available', () => {
    const result = resolveTargetVersion({});
    expect(result).toBeNull();
  });

  it('ignores server paper for velocity target', () => {
    const result = resolveTargetVersion({
      serverPaper: '1.22.0',
      activeTarget: 'velocity',
    });
    expect(result).toBeNull();
  });

  it('ignores server paper when no active target is set (undefined)', () => {
    const result = resolveTargetVersion({
      serverPaper: '1.22.0',
    });
    expect(result).toBeNull();
  });

  it('uses server paper when active target is paper', () => {
    const result = resolveTargetVersion({
      serverPaper: '1.22.0',
      activeTarget: 'paper',
    });
    expect(result).toBe('1.22.0');
  });

  it('ignores non-semver server paper value', () => {
    const result = resolveTargetVersion({
      serverPaper: 'latest',
      activeTarget: 'paper',
    });
    expect(result).toBeNull();
  });
});

describe('checkTargetVersionCompatibility', () => {
  it('returns no issues when all dependencies are compatible', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.mobs': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.mobs', {
        name: 'ink.mobs',
        version: '1.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.mobs.MobsRuntime', targetVersion: '>=1.20.0 <1.23.0' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(0);
  });

  it('returns error when dependency version range is not satisfied', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.newfeature': '^2.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.newfeature', {
        name: 'ink.newfeature',
        version: '2.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.newfeature.Runtime', targetVersion: '>=1.22.0' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('error');
    expect(issues[0].package).toBe('ink.newfeature');
    expect(issues[0].message).toContain('>=1.22.0');
  });

  it('returns warning when dependency has no matching target', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.lib': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.lib', {
        name: 'ink.lib',
        version: '1.0.0',
        dependencies: {},
        targets: {
          velocity: { entry: 'org.ink.lib.VelocityRuntime' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('warn');
    expect(issues[0].package).toBe('ink.lib');
  });

  it('returns warning when dependency has matching target but no targetVersion', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.lib': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.lib', {
        name: 'ink.lib',
        version: '1.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.lib.PaperRuntime' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('warn');
  });

  it('returns error when dependency has invalid target-version range', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.bad': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.bad', {
        name: 'ink.bad',
        version: '1.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.bad.Runtime', targetVersion: 'bananas' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('error');
    expect(issues[0].message).toContain('bananas');
  });

  it('skips check when targetVersion is null', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.mobs': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.mobs', {
        name: 'ink.mobs',
        version: '1.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.mobs.MobsRuntime', targetVersion: '>=1.22.0' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', null);
    expect(issues).toHaveLength(0);
  });

  it('handles dependency declared in manifest but missing from dep manifests map', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.missing': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>(); // empty — no manifests loaded

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    // Silently skip — can't check what we don't have
    expect(issues).toHaveLength(0);
  });

  it('handles dependency with no targets at all (target-agnostic library)', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.core': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.core', {
        name: 'ink.core',
        version: '1.0.0',
        dependencies: {},
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(0);
  });

  it('checks multiple dependencies independently', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.mobs': '^1.0.0',
        'ink.newfeature': '^2.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.mobs', {
        name: 'ink.mobs',
        version: '1.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.mobs.MobsRuntime', targetVersion: '>=1.20.0 <1.23.0' },
        },
      }],
      ['ink.newfeature', {
        name: 'ink.newfeature',
        version: '2.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.newfeature.Runtime', targetVersion: '>=1.22.0' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    // ink.mobs is compatible, ink.newfeature is not
    expect(issues).toHaveLength(1);
    expect(issues[0].package).toBe('ink.newfeature');
    expect(issues[0].type).toBe('error');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/util/target-version.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Create the target-version utility module**

Create `src/util/target-version.ts`:

```typescript
import * as semver from 'semver';
import type { PackageManifest } from '../model/manifest.js';

export interface TargetVersionSource {
  cliFlag?: string;
  buildConfig?: string;
  serverPaper?: string;
  activeTarget?: string;
}

export interface VersionIssue {
  type: 'error' | 'warn';
  package: string;
  message: string;
}

/**
 * Resolve the active target version from multiple sources.
 * Priority: CLI flag > [build].target-version > [server].paper (paper target only)
 * Returns null if no version can be resolved.
 *
 * [server].paper is ONLY used when activeTarget is explicitly "paper".
 * If activeTarget is undefined or any other value, this source is skipped.
 */
export function resolveTargetVersion(sources: TargetVersionSource): string | null {
  // 1. CLI flag — highest priority
  if (sources.cliFlag) return sources.cliFlag;

  // 2. Build config
  if (sources.buildConfig) return sources.buildConfig;

  // 3. Server paper — paper target ONLY
  // Must be explicitly targeting paper to use [server].paper as a version source
  // Value must be valid semver (e.g. "1.21.4", not "latest")
  if (sources.serverPaper && sources.activeTarget === 'paper') {
    if (semver.valid(sources.serverPaper)) {
      return sources.serverPaper;
    }
    console.warn(`Warning: [server].paper value "${sources.serverPaper}" is not a valid semver version — skipping`);
  }
  }

  // 4. No version resolved
  return null;
}

/**
 * Check all dependencies for target-version compatibility.
 * Returns a list of issues (errors and warnings).
 * If targetVersion is null, skips the check entirely.
 */
export function checkTargetVersionCompatibility(
  projectManifest: PackageManifest,
  depManifests: Map<string, PackageManifest>,
  activeTarget: string,
  targetVersion: string | null
): VersionIssue[] {
  if (targetVersion === null) return [];

  const issues: VersionIssue[] = [];

  for (const depName of Object.keys(projectManifest.dependencies)) {
    const depManifest = depManifests.get(depName);
    if (!depManifest) continue;

    // No targets at all — skip (target-agnostic library)
    if (!depManifest.targets || Object.keys(depManifest.targets).length === 0) continue;

    const targetConfig = depManifest.targets[activeTarget];

    // No matching target — warn
    if (!targetConfig) {
      issues.push({
        type: 'warn',
        package: depName,
        message: `No "${activeTarget}" target declared — version compatibility unknown`,
      });
      continue;
    }

    // Matching target but no targetVersion — warn
    if (!targetConfig.targetVersion) {
      issues.push({
        type: 'warn',
        package: depName,
        message: `No target-version declared for "${activeTarget}" — version compatibility unknown`,
      });
      continue;
    }

    // Validate the range syntax
    const range = targetConfig.targetVersion;
    if (!semver.validRange(range)) {
      issues.push({
        type: 'error',
        package: depName,
        message: `Invalid target-version range: "${range}"`,
      });
      continue;
    }

    // Check compatibility
    if (!semver.satisfies(targetVersion, range)) {
      issues.push({
        type: 'error',
        package: depName,
        message: `Requires ${activeTarget} ${range}, but project targets ${targetVersion}`,
      });
    }
  }

  return issues;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/util/target-version.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/util/target-version.ts tests/util/target-version.test.ts
git commit -m "feat: add target version resolution and compatibility checker"
```

---

## Chunk 3: Wire into CLI and commands

### Task 3: Add --target-version flag and wire into build/install

**Files:**
- Modify: `src/cli.ts:123-131` (build command)
- Modify: `src/cli.ts:99-102` (install command)
- Modify: `src/commands/ink-build.ts:18-29`
- Modify: `src/commands/install.ts`

- [ ] **Step 1: Add --target-version flag to build command in CLI**

In `src/cli.ts`, modify the build command (lines 123-131). Add `--target-version` option:

```typescript
program
  .command('build')
  .description('Compile grammar and/or Ink scripts')
  .option('-F, --full', 'Force full recompilation of all scripts')
  .option('--target-version <version>', 'Target platform version for compatibility checks')
  .action(async (opts) => {
    requireProject()
    const cmd = new InkBuildCommand(process.cwd())
    await cmd.run({ full: !!opts.full, targetVersion: opts.targetVersion })
  })
```

- [ ] **Step 2: Add --target-version flag to install command in CLI**

In `src/cli.ts`, modify the install command (lines 99-102). Add `--target-version` option:

```typescript
program.command('install').description('Install all dependencies from ink-package.toml').option('--dry-run', 'Show what would be installed without downloading').option('--target-version <version>', 'Target platform version for compatibility checks').action(async (opts) => {
  requireProject()
  await new InstallCommand(projectDir).run({ dryRun: !!opts.dryRun, verbose: !!program.opts().verbose, targetVersion: opts.targetVersion })
});
```

- [ ] **Step 3: Update InkBuildCommand to accept and use targetVersion**

In `src/commands/ink-build.ts`:

1. Add import at top of file:
```typescript
import { resolveTargetVersion, checkTargetVersionCompatibility } from '../util/target-version.js';
```

2. Update the `run` method signature (line 21):
```typescript
async run(opts: { full?: boolean; targetVersion?: string } = {}): Promise<void> {
```

3. After `targetConfig` is resolved (after line 41), add target version resolution and compatibility check:
```typescript
    // Resolve target version
    const targetVersion = resolveTargetVersion({
      cliFlag: opts.targetVersion,
      buildConfig: manifest.build?.targetVersion,
      serverPaper: manifest.server?.paper,
      activeTarget: targetName,
    });

    if (targetVersion) {
      const depManifests = this.loadDepManifests();
      const issues = checkTargetVersionCompatibility(manifest, depManifests, targetName, targetVersion);
      for (const issue of issues) {
        if (issue.type === 'error') {
          console.error(`Error: ${issue.package}: ${issue.message}`);
        } else {
          console.warn(`Warning: ${issue.package}: ${issue.message}`);
        }
      }
      const errors = issues.filter(i => i.type === 'error');
      if (errors.length > 0) {
        process.exit(1);
      }
    } else if (Object.keys(manifest.dependencies).length > 0) {
      console.log('Note: No target version specified — skipping version compatibility checks');
    }
```

4. Add the `loadDepManifests` helper method to the class. This reads `ink-package.toml` from each installed package directory. Package directories are named with `/` replaced by `-`, and dependency keys use `.` — so we build a reverse mapping from directory names back to the dependency key using the project's `dependencies` map:

```typescript
  private loadDepManifests(): Map<string, PackageManifest> {
    const depManifests = new Map<string, PackageManifest>();
    const packagesDir = join(this.projectDir, 'packages');
    if (!existsSync(packagesDir)) return depManifests;

    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'));
    const depKeys = Object.keys(manifest.dependencies);

    for (const dirName of readdirSync(packagesDir)) {
      const pkgDir = join(packagesDir, dirName);
      const tomlPath = join(pkgDir, 'ink-package.toml');
      if (!existsSync(tomlPath)) continue;

      // Match directory name to dependency key: "ink-mobs" could match "ink.mobs"
      const matchedKey = depKeys.find(k => k.replace(/\//g, '-') === dirName);
      if (!matchedKey) continue;

      try {
        depManifests.set(matchedKey, TomlParser.read(tomlPath));
      } catch {
        // Skip packages with unparseable manifests
      }
    }
    return depManifests;
  }
```

- [ ] **Step 4: Update InstallCommand to accept and use targetVersion**

In `src/commands/install.ts`:

1. Add import at top of file:
```typescript
import { resolveTargetVersion, checkTargetVersionCompatibility } from '../util/target-version.js';
```

2. Update `InstallOptions` (lines 11-14):
```typescript
export interface InstallOptions {
  dryRun?: boolean
  verbose?: boolean
  targetVersion?: string
}
```

3. After the package extraction loop (after line 159), add the compatibility check. This runs AFTER packages are extracted so manifests are available on disk for first-time installs:

```typescript
    // Check target-version compatibility against newly installed packages
    const activeTarget = manifest.target ?? manifest.build?.target ?? 'default';
    const targetVersion = resolveTargetVersion({
      cliFlag: opts.targetVersion,
      buildConfig: manifest.build?.targetVersion,
      serverPaper: manifest.server?.paper,
      activeTarget,
    });

    if (targetVersion) {
      const depManifests = new Map<string, PackageManifest>();
      const depKeys = Object.keys(manifest.dependencies);
      for (const dirName of fs.readdirSync(packagesDir)) {
        const tomlPath = path.join(packagesDir, dirName, 'ink-package.toml');
        if (!fs.existsSync(tomlPath)) continue;
        const matchedKey = depKeys.find(k => k.replace(/\//g, '-') === dirName);
        if (!matchedKey) continue;
        try {
          depManifests.set(matchedKey, TomlParser.read(tomlPath));
        } catch {}
      }
      const issues = checkTargetVersionCompatibility(manifest, depManifests, activeTarget, targetVersion);
      for (const issue of issues) {
        if (issue.type === 'error') {
          console.error(`Error: ${issue.package}: ${issue.message}`);
        } else {
          console.warn(`Warning: ${issue.package}: ${issue.message}`);
        }
      }
      const errors = issues.filter(i => i.type === 'error');
      if (errors.length > 0) {
        process.exit(1);
      }
    } else if (Object.keys(manifest.dependencies).length > 0) {
      console.log('Note: No target version specified — skipping version compatibility checks');
    }
```

- [ ] **Step 5: Build and run full test suite**

Run: `npm run build && npx vitest run`
Expected: Build succeeds, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/commands/ink-build.ts src/commands/install.ts
git commit -m "feat: wire target-version checking into build and install commands"
```

---

## Chunk 4: Legacy deprecation warning

### Task 4: Add deprecation warning for legacy build.target-version

**Files:**
- Modify: `src/commands/ink-build.ts`
- Modify: `src/commands/install.ts`

- [ ] **Step 1: Add legacy deprecation warning in InkBuildCommand**

In `src/commands/ink-build.ts`, inside the `run()` method, after target version resolution and the compatibility check block, add:

```typescript
    // Warn about deprecated [build].target-version if per-target version also exists
    if (manifest.build?.targetVersion && targetConfig?.targetVersion) {
      console.warn(`Warning: Both [build].target-version and [targets.${targetName}].target-version are set.`);
      console.warn('  The per-target value takes precedence. [build].target-version is deprecated.');
    }
```

- [ ] **Step 2: Add same warning in InstallCommand**

In `src/commands/install.ts`, after the compatibility check block, add:

```typescript
    // Warn about deprecated [build].target-version
    const activeTargetConfig = manifest.targets?.[activeTarget];
    if (manifest.build?.targetVersion && activeTargetConfig?.targetVersion) {
      console.warn(`Warning: Both [build].target-version and [targets.${activeTarget}].target-version are set.`);
      console.warn('  The per-target value takes precedence. [build].target-version is deprecated.');
    }
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/ink-build.ts src/commands/install.ts
git commit -m "feat: add deprecation warning for legacy build.target-version"
```
