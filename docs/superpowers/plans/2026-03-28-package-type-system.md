# Package Type System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `type` field to distinguish `script` and `library` Ink packages across quill CLI, lectern registry, and supabase database.

**Architecture:** Explicit enum field (`script`|`library`) in ink-package.toml, validated at publish, stored as constrained DB column, surfaced as badge+filter on website. Two repos: quill (CLI) and lectern (registry).

**Tech Stack:** TypeScript (quill), Astro/TypeScript (lectern), SQL (supabase), vitest (tests)

**Key conventions:**
- `defaultManifest` currently uses `main: 'mod'` — this plan does NOT change that default. The `type` field defaults to `'script'` at parse time in `TomlParser.read`, not in `defaultManifest`. The `main` default of `'main'` is applied by `TomlParser.read` for scripts only.
- The package detail page is at `src/pages/[user]/[slug].astro` (not `src/pages/packages/[name].astro`, which is now a redirect).
- The lectern `PackageVersion` interface has `package_slug` but NOT `package_name`; `insertVersion` accepts `package_name` as a separate inline field. Add `package_type` as a separate field following the same pattern.
- The `X-Package-Type` header is read inside the `application/vnd.ink-publish+gzip` content-type branch (same as `X-Package-Targets`), not outside.

---

## Chunk 1: Quill CLI — Model & Parser

### Task 1: Add `type` field to PackageManifest

**Files:**
- Modify: `src/model/manifest.ts`
- Test: `tests/model/manifest.test.ts`

- [ ] **Step 1: Write failing test for type field in manifest**

In `tests/model/manifest.test.ts`, add:

```typescript
import { defaultManifest, type PackageManifest } from '../../src/model/manifest.js'

it('defaultManifest includes type: "script"', () => {
  const m = defaultManifest('test-pkg');
  expect(m.type).toBe('script');
  expect(m.main).toBe('mod');  // existing default unchanged
});

it('library manifest can omit main', () => {
  const m: PackageManifest = {
    name: 'ink.mobs',
    version: '0.1.0',
    type: 'library',
    dependencies: {},
  };
  expect(m.type).toBe('library');
  expect(m.main).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/model/manifest.test.ts`
Expected: FAIL — `type` not on interface, `defaultManifest` doesn't include it

- [ ] **Step 3: Add `type` to PackageManifest and defaultManifest**

In `src/model/manifest.ts`:

Add to the `PackageManifest` interface (after `version`):
```typescript
type?: 'script' | 'library';
```

Change `main: string` to `main?: string`.

Update `defaultManifest` — keep existing `main: 'mod'` default, add `type: 'script'`:
```typescript
export function defaultManifest(name: string): PackageManifest {
  return {
    name,
    version: '0.1.0',
    type: 'script',
    main: 'mod',
    dependencies: {},
    targets: {},
  };
}
```

Note: `defaultManifest` is used by `scaffoldPackage` (the `--package` code path) which uses `main: 'mod'`. The `scaffoldProject` code path uses `main: 'main'`. This plan does not change those existing defaults — only adds the `type` field.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/model/manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/model/manifest.ts tests/model/manifest.test.ts
git commit -m "feat(quill): add type field to PackageManifest"
```

---

### Task 2: Parse and write `type` in TomlParser

**Files:**
- Modify: `src/util/toml.ts`
- Test: `tests/util/toml.test.ts`

- [ ] **Step 1: Write failing tests for type parsing**

In `tests/util/toml.test.ts`, add a new describe block:

```typescript
describe('TomlParser with package type', () => {
  const tmpDir = os.tmpdir();

  it('reads type = "library" from toml', () => {
    const content = `
[package]
name = "ink.mobs"
version = "1.0.0"
type = "library"
`;
    const filePath = path.join(tmpDir, 'quill-type-lib-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);
    const manifest = TomlParser.read(filePath);
    expect(manifest.type).toBe('library');
    expect(manifest.main).toBeUndefined();
    fs.unlinkSync(filePath);
  });

  it('defaults type to "script" when absent', () => {
    const content = `
[package]
name = "my-game"
version = "1.0.0"
main = "main"
`;
    const filePath = path.join(tmpDir, 'quill-type-default-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);
    const manifest = TomlParser.read(filePath);
    expect(manifest.type).toBe('script');
    expect(manifest.main).toBe('main');
    fs.unlinkSync(filePath);
  });

  it('defaults main to "main" for script type', () => {
    const content = `
[package]
name = "my-game"
version = "1.0.0"
`;
    const filePath = path.join(tmpDir, 'quill-type-script-nomain-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);
    const manifest = TomlParser.read(filePath);
    expect(manifest.type).toBe('script');
    expect(manifest.main).toBe('main');
    fs.unlinkSync(filePath);
  });

  it('throws on invalid type value', () => {
    const content = `
[package]
name = "bad-pkg"
version = "1.0.0"
type = "banana"
`;
    const filePath = path.join(tmpDir, 'quill-type-invalid-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);
    expect(() => TomlParser.read(filePath)).toThrow(/invalid.*type/i);
    fs.unlinkSync(filePath);
  });

  it('writes type to toml when present', () => {
    const manifest: PackageManifest = {
      name: 'ink.mobs',
      version: '0.1.0',
      type: 'library',
      dependencies: {},
    };
    const filePath = path.join(tmpDir, 'quill-write-type-' + Date.now() + '.toml');
    const tomlString = TomlParser.write(manifest);
    fs.writeFileSync(filePath, tomlString);
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toContain('type = "library"');
    expect(written).not.toContain('main');
    fs.unlinkSync(filePath);
  });

  it('omits type from toml when it is the default "script"', () => {
    const manifest: PackageManifest = {
      name: 'my-game',
      version: '0.1.0',
      type: 'script',
      main: 'main',
      dependencies: {},
    };
    const tomlString = TomlParser.write(manifest);
    // type="script" is the default, so it can be omitted for cleanliness
    // but we include it for explicitness
    expect(tomlString).toContain('type = "script"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/util/toml.test.ts`
Expected: FAIL — `type` not parsed, no validation

- [ ] **Step 3: Implement type parsing and writing in TomlParser**

In `src/util/toml.ts`, update `readFromString`:

After reading `pkg`, add type parsing:
```typescript
const VALID_TYPES = ['script', 'library'] as const;
let packageType: 'script' | 'library' | undefined = pkg.type;
if (packageType !== undefined && !VALID_TYPES.includes(packageType)) {
  throw new Error(`invalid package type: "${packageType}". Must be "script" or "library".`);
}
packageType = packageType ?? 'script';
```

Then in both return statements (legacy runtime branch and normal branch):
- Add `type: packageType,`
- Change `main:` to conditionally default based on type:
  - For `script`: `main: pkg.main ?? pkg.entry ?? 'main',`
  - For `library`: `main: pkg.main ?? pkg.entry,` (no default)

In `write`, add `type` to the package object in `data`:
```typescript
...(manifest.type ? { type: manifest.type } : {}),
```

And only write `main` when it has a value:
```typescript
...(manifest.main ? { main: manifest.main } : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/util/toml.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: All existing tests still pass (existing TOML fixtures without `type` will default to `script` with `main`)

- [ ] **Step 6: Commit**

```bash
git add src/util/toml.ts tests/util/toml.test.ts
git commit -m "feat(quill): parse and write package type in TomlParser"
```

---

### Task 3: Update `quill new` with `--type` flag

**Files:**
- Modify: `src/commands/new.ts`
- Modify: `src/cli.ts` (to register the flag)
- Test: `tests/commands/new.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/commands/new.test.ts`, add:

```typescript
it('scaffolds script project with --type=script', () => {
  execSync(
    `npx tsx ${CLI} new my-project --type=script --template=blank`,
    { cwd: FIXTURES, encoding: 'utf8' }
  )
  const pkg = join(FIXTURES, 'my-project')
  const manifest = TomlParser.read(join(pkg, 'ink-package.toml'))
  expect(manifest.type).toBe('script')
  expect(manifest.main).toBe('main')
  expect(existsSync(join(pkg, 'scripts/main.ink'))).toBe(true)
})

it('scaffolds library project with --type=library', () => {
  execSync(
    `npx tsx ${CLI} new lib-project --type=library`,
    { cwd: FIXTURES, encoding: 'utf8' }
  )
  const pkg = join(FIXTURES, 'lib-project')
  const manifest = TomlParser.read(join(pkg, 'ink-package.toml'))
  expect(manifest.type).toBe('library')
  expect(manifest.main).toBeUndefined()
  expect(existsSync(join(pkg, 'scripts'))).toBe(false)
})
```

Update the `afterEach` cleanup list to include `'my-project'`, `'lib-project'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/new.test.ts`
Expected: FAIL — `--type` flag not recognized

- [ ] **Step 3: Implement --type flag**

In `src/commands/new.ts`, update the `NewCommandOptions` interface:
```typescript
export interface NewCommandOptions {
  isPackage: boolean;
  template?: string;
  type?: 'script' | 'library';
}
```

Update `scaffoldProject` to use the type:
```typescript
const packageType = opts.type ?? 'script';
const manifest: PackageManifest = {
  name,
  version: '0.1.0',
  type: packageType,
  ...(packageType === 'script' ? { main: 'main' } : {}),
  dependencies: {},
  ...(author ? { author } : {}),
};

fs.writeFileSync(
  path.join(targetDir, 'ink-package.toml'),
  TomlParser.write(manifest)
);

if (packageType === 'script') {
  fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, 'scripts/main.ink'),
    templateContent(name, template)
  );
}
```

In `src/cli.ts`, find the `new` command registration and add the `--type` option:
```typescript
.option('--type <type>', 'package type: script or library', 'script')
```

Pass it through to `NewCommandOptions`: `type: opts.type as 'script' | 'library'`.

Also update `scaffoldPackage` (the `--package` code path) to respect the type flag. Currently `scaffoldPackage` always creates `main: 'mod'` and `scripts/main.ink`. When `type === 'library'`, skip `main` and `scripts/`:

```typescript
private async scaffoldPackage(name: string, targetDir: string, type: 'script' | 'library' = 'script'): Promise<void> {
  // ... existing setup ...
  const manifest: PackageManifest = {
    name,
    version: '0.1.0',
    type,
    ...(type === 'script' ? { main: 'mod' } : {}),
    dependencies: {},
    grammar: { entry: 'src/grammar.ts', output: 'dist/grammar.ir.json' },
    // ... rest of existing package scaffolding ...
  };
  // Only create scripts/ for script type
  if (type === 'script') {
    fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'scripts/main.ink'), `// ${name}\n`);
  }
}
```

Update `run()` to pass `opts.type` through to `scaffoldPackage`:
```typescript
if (opts.isPackage) {
  await this.scaffoldPackage(name, targetDir, opts.type);
} else {
  // ...
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/new.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/new.ts src/cli.ts tests/commands/new.test.ts
git commit -m "feat(quill): add --type flag to quill new"
```

---

### Task 4: Update `quill init` with `--type` flag

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `src/cli.ts` (to register the flag)
- Create: `tests/commands/init.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/commands/init.test.ts`:

```typescript
import { execSync } from 'child_process'
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, afterEach } from 'vitest'
import { TomlParser } from '../../src/util/toml.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.ts')
const TMP = join(__dirname, '../fixtures/init-test')

describe('quill init', () => {
  afterEach(() => {
    try { rmSync(join(TMP, 'ink-package.toml')) } catch {}
    try { rmSync(TMP, { recursive: true }) } catch {}
  })

  it('creates ink-package.toml with type=script by default', () => {
    mkdirSync(TMP, { recursive: true })
    execSync(`npx tsx ${CLI} init`, { cwd: TMP, encoding: 'utf8' })
    const manifest = TomlParser.read(join(TMP, 'ink-package.toml'))
    expect(manifest.type).toBe('script')
    expect(manifest.main).toBe('main')
  })

  it('creates ink-package.toml with type=library', () => {
    mkdirSync(TMP, { recursive: true })
    execSync(`npx tsx ${CLI} init --type=library`, { cwd: TMP, encoding: 'utf8' })
    const manifest = TomlParser.read(join(TMP, 'ink-package.toml'))
    expect(manifest.type).toBe('library')
    expect(manifest.main).toBeUndefined()
  })

  it('skips if ink-package.toml already exists', () => {
    mkdirSync(TMP, { recursive: true })
    // Write a placeholder
    const content = '[package]\nname = "existing"\nversion = "1.0.0"\n'
    require('fs').writeFileSync(join(TMP, 'ink-package.toml'), content)
    const result = execSync(`npx tsx ${CLI} init`, { cwd: TMP, encoding: 'utf8' })
    expect(result).toContain('already exists')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/init.test.ts`
Expected: FAIL — `--type` flag not recognized

- [ ] **Step 3: Add --type flag to init command**

In `src/commands/init.ts`, update the `run` method to accept an options parameter:
```typescript
async run(opts?: { type?: 'script' | 'library' }): Promise<void> {
  const inkPackageToml = path.join(this.projectDir, 'ink-package.toml');
  if (fs.existsSync(inkPackageToml)) {
    console.log('ink-package.toml already exists.');
    return;
  }

  const name = path.basename(this.projectDir).toLowerCase();
  const packageType = opts?.type ?? 'script';
  const manifest: PackageManifest = {
    name,
    version: '0.1.0',
    type: packageType,
    ...(packageType === 'script' ? { main: 'main' } : {}),
    dependencies: {},
  };

  fs.writeFileSync(inkPackageToml, TomlParser.write(manifest));
  console.log(`Created ink-package.toml: ${name} v0.1.0 (${packageType})`);
}
```

In `src/cli.ts`, find the `init` command registration and add `--type` option, passing it through.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/init.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts src/cli.ts tests/commands/init.test.ts
git commit -m "feat(quill): add --type flag to quill init"
```

---

### Task 5: Validate script `main` on publish

**Files:**
- Modify: `src/commands/publish.ts`
- Test: `tests/commands/publish.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/commands/publish.test.ts`, add a test fixture that has `type = "script"` but no compiled `main.inkc` file, and verify the publish command exits with an error about missing entry point.

Since the existing publish test uses CLI exec, create a fixture:

```
tests/fixtures/script-no-main/
  ink-package.toml  (type = "script", main = "main")
```

```typescript
it('errors when script package has no compiled main on disk', () => {
  try {
    execSync(
      `npx tsx ${CLI} publish`,
      {
        cwd: join(FIXTURES, 'script-no-main'),
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, HOME: '/tmp/no-home' }
      }
    )
    expect.unreachable('should have thrown')
  } catch (e: any) {
    // Will fail at auth first, so we test the validation runs before auth
    // OR we test the validation function directly
    const output = e.stderr.toString()
    // The validation should error about missing entry point
    // Note: may fail at auth first depending on order
    expect(output).toMatch(/entry point|main/)
  }
})
```

Alternatively, test the validation logic as a unit:

```typescript
import { validateScriptEntry } from '../../src/commands/publish.js'

describe('validateScriptEntry', () => {
  it('returns error when compiled main does not exist', () => {
    const result = validateScriptEntry('/nonexistent/dist', 'main', undefined)
    expect(result).toMatch(/entry point/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/publish.test.ts`

- [ ] **Step 3: Add validation to publish command**

In `src/commands/publish.ts`, after building and before sending the request, add validation:

```typescript
// Validate entry point for script packages
const packageType = manifest.type ?? 'script';
if (packageType === 'script') {
  const mainName = manifest.main;
  if (!mainName) {
    console.error('Script packages must have a "main" entry point in ink-package.toml');
    process.exit(1);
  }
  // Check compiled output exists.
  // Build output structure follows ink-build.ts:
  //   Single-target (no targets table): dist/scripts/<name>.inkc
  //   Multi-target: dist/<target>/scripts/<name>.inkc
  const hasTargets = manifest.targets && Object.keys(manifest.targets).length > 0;
  let mainPath: string;
  if (hasTargets) {
    // Use the first target (or the explicit manifest.target if set)
    const targetName = manifest.target ?? Object.keys(manifest.targets!)[0];
    mainPath = join(distDir, targetName, 'scripts', `${mainName}.inkc`);
  } else {
    mainPath = join(distDir, 'scripts', `${mainName}.inkc`);
  }
  if (!existsSync(mainPath)) {
    console.error(`Entry point not found: ${mainPath}`);
    console.error('Script packages require a compiled entry point. Check your "main" field in ink-package.toml.');
    process.exit(1);
  }
}
```

Also add the `X-Package-Type` header to the publish request (in the headers object near `X-Package-Targets`):
```typescript
headers['X-Package-Type'] = packageType;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/publish.test.ts`

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add src/commands/publish.ts tests/commands/publish.test.ts
git commit -m "feat(quill): validate script main entry point on publish"
```

---

### Task 6: Add `package_type` to RegistryPackageVersion

**Files:**
- Modify: `src/registry/client.ts`
- Test: `tests/registry/client.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/registry/client.test.ts`, add:

```typescript
it('parses package_type from version data', () => {
  const json = JSON.stringify({
    packages: {
      'ink.mobs': {
        '1.0.0': {
          url: 'https://example.com/ink.mobs-1.0.0.tar.gz',
          dependencies: {},
          package_type: 'library',
        }
      }
    }
  })
  const index = new RegistryClient().parseIndex(json)
  const pkg = (index as any).get('ink.mobs')
  expect(pkg?.versions.get('1.0.0')?.packageType).toBe('library')
})

it('package_type defaults to "script" when absent', () => {
  const json = JSON.stringify({
    packages: {
      'my-game': {
        '1.0.0': {
          url: 'https://example.com/my-game-1.0.0.tar.gz',
          dependencies: {},
        }
      }
    }
  })
  const index = new RegistryClient().parseIndex(json)
  const pkg = (index as any).get('my-game')
  expect(pkg?.versions.get('1.0.0')?.packageType).toBe('script')
})
```

Also add `package_type` to the `SearchResult` interface test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registry/client.test.ts`

- [ ] **Step 3: Add packageType to RegistryPackageVersion**

In `src/registry/client.ts`:

Add to `RegistryPackageVersion` constructor:
```typescript
public readonly packageType?: string,
```

In `parseIndex`, pass `package_type` through:
```typescript
verData.package_type ?? 'script',
```

Add to `SearchResult`:
```typescript
package_type: string;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/registry/client.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/registry/client.ts tests/registry/client.test.ts
git commit -m "feat(quill): add package_type to RegistryPackageVersion and SearchResult"
```

---

## Chunk 2: Lectern Registry — Database & API

### Task 7: Add `package_type` column to database

**Files:**
- Create: `supabase/migrations/20260328_package_type.sql` (in lectern repo)

- [ ] **Step 1: Create migration file**

In `/c/Users/justi/dev/lectern/supabase/migrations/20260328_package_type.sql`:

```sql
-- Add package_type to distinguish script vs library packages
alter table package_versions add column package_type text not null default 'script';
alter table package_versions add constraint valid_package_type
  check (package_type in ('script', 'library'));
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push` or apply via the Supabase MCP tool using project ID `nctoangzgeurkhrkttlv`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260328_package_type.sql
git commit -m "feat(lectern): add package_type column to package_versions"
```

---

### Task 8: Update Lectern `PackageVersion` and `insertVersion`

**Files:**
- Modify: `src/lib/db.ts` (in lectern repo)

- [ ] **Step 1: Add package_type to interfaces and insert**

In `src/lib/db.ts`:

Add `package_type?: string` to the `PackageVersion` interface (optional since old rows defaulted to `'script'`).

The `insertVersion` function accepts an inline object (not `Omit<PackageVersion, ...>`). It includes `package_name` as a field that is NOT on the `PackageVersion` interface — this is the existing pattern. Add `package_type` following the same pattern:

```typescript
export async function insertVersion(pkg: {
  package_name: string
  package_slug: string
  version: string
  description: string | null
  readme: string | null
  dependencies: Record<string, string>
  tarball_url: string
  embedding: string | null
  targets?: string[]
  package_type?: string   // NEW
}): Promise<void> {
  const { data, error } = await supabase
    .from('package_versions')
    .insert({
      package_name: pkg.package_name,
      package_slug: pkg.package_slug,
      version: pkg.version,
      description: pkg.description,
      readme: pkg.readme,
      dependencies: pkg.dependencies,
      tarball_url: pkg.tarball_url,
      embedding: pkg.embedding,
      targets: pkg.targets,
      package_type: pkg.package_type ?? 'script',   // NEW
    })
    .select()
  if (error) throw error
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(lectern): add package_type to PackageVersion and insertVersion"
```

---

### Task 9: Accept `X-Package-Type` header in publish endpoint

**Files:**
- Modify: `src/pages/api/packages/[name]/[version].ts` (in lectern repo)

- [ ] **Step 1: Read header and pass to insertVersion**

In the PUT handler, inside the `application/vnd.ink-publish+gzip` branch — the same block where `X-Package-Targets` is parsed (after the existing `targets` extraction), add:

```typescript
const packageType = request.headers.get('X-Package-Type') ?? 'script';
if (packageType !== 'script' && packageType !== 'library') {
  return new Response(JSON.stringify({ error: 'Invalid X-Package-Type. Must be "script" or "library".' }), { status: 400 });
}
```

Then pass `package_type: packageType` to the `insertVersion` call (which is after the content-type branches). Since `packageType` is declared inside the branch, hoist the declaration before the content-type check by defaulting to `'script'` and overriding inside the `ink-publish+gzip` branch.

- [ ] **Step 2: Commit**

```bash
git add src/pages/api/packages/[name]/[version].ts
git commit -m "feat(lectern): accept X-Package-Type header in publish endpoint"
```

---

### Task 10: Add `package_type` to search results and filtering

**Files:**
- Modify: `src/lib/search.ts` (in lectern repo)
- Modify: `src/pages/api/search.ts` (in lectern repo)

- [ ] **Step 1: Add package_type to SearchResult**

In `src/lib/search.ts`, add `package_type: string` to the `SearchResult` interface.

Update `hybridSearch` to accept an optional `type` parameter:
```typescript
export async function hybridSearch(query: string, limit = 20, type?: 'script' | 'library'): Promise<SearchResult[]>
```

Add `.eq('package_type', type)` to both the FTS and semantic Supabase queries when `type` is provided.

Also add `package_type` to the SELECT columns in both queries.

Map `package_type` into the returned `SearchResult` objects.

- [ ] **Step 2: Update search API endpoint**

In `src/pages/api/search.ts`, read the `type` query param and pass to `hybridSearch`:

```typescript
const typeParam = url.searchParams.get('type') as 'script' | 'library' | null
const results = await hybridSearch(q, 20, typeParam ?? undefined)
```

- [ ] **Step 3: Update index.json to include package_type**

In `src/pages/index.json.ts`, the existing `listAllPackages` uses `SELECT *` so `package_type` will be included automatically. Verify the output includes it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/search.ts src/pages/api/search.ts src/pages/index.json.ts
git commit -m "feat(lectern): add package_type to search results and filtering"
```

---

## Chunk 3: Lectern Website — Badge & Filter

### Task 11: Add type badge to package detail page

**Files:**
- Modify: `src/pages/[owner]/[slug].astro` (in lectern repo — this is the actual detail page; `packages/[name].astro` redirects here)
- Create: `src/components/PackageTypeBadge.astro` (in lectern repo)

- [ ] **Step 1: Create PackageTypeBadge component**

Create `src/components/PackageTypeBadge.astro`:

```astro
---
interface Props {
  type: string;
  size?: 'sm' | 'md';
}
const { type, size = 'md' } = Astro.props;
const isLibrary = type === 'library';
const label = isLibrary ? 'Library' : 'Script';
const color = isLibrary ? '#8b5cf6' : '#3b82f6';
const bg = isLibrary ? 'rgba(139,92,246,0.1)' : 'rgba(59,130,246,0.1)';
---

<span
  class={`pkg-type-badge ${size}`}
  style={`color:${color};background:${bg};border:1px solid ${color};`}
  title={`This is a ${label.toLowerCase()} package`}
>
  {label}
</span>

<style>
  .pkg-type-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-family: var(--font-mono, monospace);
    font-weight: 500;
    border-radius: 4px;
    vertical-align: middle;
  }
  .pkg-type-badge.sm {
    font-size: 0.65rem;
    padding: 0.1rem 0.35rem;
  }
  .pkg-type-badge.md {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
  }
</style>
```

- [ ] **Step 2: Add badge to package detail page**

In the package detail page, after the package name/version header section, add:

```astro
import PackageTypeBadge from '../../components/PackageTypeBadge.astro'
```

Render the badge next to the version badge:
```astro
<PackageTypeBadge type={latestVersion.package_type ?? 'script'} />
```

Fetch `package_type` from the version data in the frontmatter.

- [ ] **Step 3: Commit**

```bash
git add src/components/PackageTypeBadge.astro "src/pages/[owner]/[slug].astro"
git commit -m "feat(lectern): add package type badge to detail page"
```

---

### Task 12: Add type filter to packages listing page

**Files:**
- Modify: `src/pages/packages/index.astro` (in lectern repo)

- [ ] **Step 1: Add type filter pills to the page**

In `src/pages/packages/index.astro`, add a `type` filter param alongside `sort`:

In the frontmatter, read the type param:
```typescript
const selectedType = Astro.url.searchParams.get('type') ?? null
```

Add filtering logic **after** all four branches build `allPackages` / `popularPackages` / `starSortedPackages`, and **before** pagination. The type filter applies as a post-filter on the already-built arrays. For `allPackages` (used by `recent`, tag-filtered, and `stars` paths):

```typescript
// Apply type filter (after building allPackages, before pagination)
if (selectedType) {
  allPackages = allPackages.filter(p =>
    (p.latest as any).package_type === selectedType
  )
  totalCount = allPackages.length
}
```

For the `popular` sort path, filter `popularPackages` similarly before mapping to `displayPackages`.

Note: `listAllPackages` uses `SELECT *` so `package_type` will be on the `latest` object. For `popular` sort using `getPopularPackages` RPC, the RPC may need updating to include `package_type` in its return — check the function definition and add the column if needed.

Add type filter pills in the HTML, next to the sort chips:
```html
<div class="type-chips">
  <button class={`type-chip${!selectedType ? ' active' : ''}`} data-type="">all</button>
  <button class={`type-chip${selectedType === 'script' ? ' active' : ''}`} data-type="script">scripts</button>
  <button class={`type-chip${selectedType === 'library' ? ' active' : ''}`} data-type="library">libraries</button>
</div>
```

Style them identically to the existing `.sort-chip` class.

Update `buildPageUrl` to include the type param:
```typescript
if (selectedType) params.set('type', selectedType)
```

Wire click handlers in the `<script>` section to navigate with the type param.

- [ ] **Step 2: Add type badge to package cards**

In the card template (both server-rendered and search JS), add the type badge after the package name:

For server-rendered cards:
```astro
{(pkg.latest as any).package_type && (
  <span class={`pkg-type ${(pkg.latest as any).package_type}`}>
    {(pkg.latest as any).package_type === 'library' ? 'Library' : 'Script'}
  </span>
)}
```

For search results (in the JS section), add the badge HTML:
```javascript
const typeBadge = pkg.package_type
  ? '<span class="pkg-type ' + pkg.package_type + '">' + (pkg.package_type === 'library' ? 'Library' : 'Script') + '</span>'
  : ''
```

Add CSS:
```css
.pkg-type {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  margin-left: 0.4rem;
  vertical-align: middle;
}
.pkg-type.library {
  color: #8b5cf6;
  background: rgba(139,92,246,0.1);
  border: 1px solid #8b5cf6;
}
.pkg-type.script {
  color: #3b82f6;
  background: rgba(59,130,246,0.1);
  border: 1px solid #3b82f6;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/packages/index.astro
git commit -m "feat(lectern): add type filter and badge to packages listing"
```

---

## Chunk 4: Integration & Verification

### Task 13: End-to-end smoke test

- [ ] **Step 1: Test quill new with type**

```bash
cd /tmp && npx tsx /c/Users/justi/dev/quill/src/cli.ts new test-script --type=script
cat test-script/ink-package.toml  # Should have type = "script", main = "main"
rm -rf test-script

npx tsx /c/Users/justi/dev/quill/src/cli.ts new test-lib --type=library
cat test-lib/ink-package.toml  # Should have type = "library", no main
rm -rf test-lib
```

- [ ] **Step 2: Test quill publish validation**

Create a script package fixture without a dist/ directory and verify publish fails with the entry point error.

- [ ] **Step 3: Verify lectern dev server**

```bash
cd /c/Users/justi/dev/lectern && npm run dev
```

Visit `/packages` and verify:
- Type filter pills appear (all / scripts / libraries)
- Package cards show type badges
- Filtering works

Visit a package detail page and verify the type badge appears.

- [ ] **Step 4: Run full quill test suite**

```bash
cd /c/Users/justi/dev/quill && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Run lectern tests**

```bash
cd /c/Users/justi/dev/lectern && npm test
```

Expected: All tests pass.

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "feat: package type system complete — script/library distinction"
```
