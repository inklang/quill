# quill new — Script Projects vs Grammar Packages Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distinguish between script projects (`quill new <name>`) and grammar packages (`quill new <name> --package`), with an interactive template picker for script projects.

**Architecture:** Two paths in `NewCommand.run()` — `isPackage: true` keeps the existing grammar+runtime scaffold unchanged; `isPackage: false` writes a minimal manifest + `.ink` script. Template selection happens via an inline wizard (readline, line-mode) or the `--template` CLI flag. CLI option validation (mutual exclusion, unknown templates) lives in the action handler before `NewCommand` is called.

**Tech Stack:** TypeScript, Node.js built-in `readline`, `commander` for CLI, `@iarna/toml` via the existing `TomlParser`, vitest for tests.

---

## Chunk 1: Tests + CLI wiring

### Task 1: Update existing `new` test to use `--package`

The existing test runs `quill new ink.mobs` and expects the full grammar+runtime scaffold. After this change, that behavior moves to `quill new ink.mobs --package`. Update the test before touching any implementation so it drives the work.

**Files:**
- Modify: `tests/commands/new.test.ts`

- [ ] **Step 1: Update the existing package scaffold test to pass `--package`**

Update the import at the top of the file to include `mkdirSync`:
```ts
import { readFileSync, existsSync, rmSync, mkdirSync } from 'fs'
```

In `tests/commands/new.test.ts`, change:
```ts
const result = execSync(
  `npx tsx ${CLI} new ink.mobs`,
  { cwd: FIXTURES, encoding: 'utf8' }
)
```
to:
```ts
const result = execSync(
  `npx tsx ${CLI} new ink.mobs --package`,
  { cwd: FIXTURES, encoding: 'utf8' }
)
```

Also update the `afterEach` cleanup to cover new test dirs (see step 2 below).

- [ ] **Step 2: Remove the old `rejects if directory already exists` test and replace it**

Delete the existing `it('rejects if directory already exists', ...)` block (lines 61-73). Replace it with the version below, which uses `threw` + exit code assertion so the test actually fails if `process.exit(1)` is not called.

- [ ] **Step 3: Add tests for script project scaffolding**

Add these test cases to the same `describe('quill new', ...)` block:

```ts
afterEach(() => {
  for (const name of ['ink.mobs', 'existing-pkg', 'my-project', 'hello-project', 'full-project']) {
    try { rmSync(join(FIXTURES, name), { recursive: true }) } catch {}
  }
})

it('scaffolds minimal script project with --template=blank', () => {
  execSync(
    `npx tsx ${CLI} new my-project --template=blank`,
    { cwd: FIXTURES, encoding: 'utf8' }
  )
  const pkg = join(FIXTURES, 'my-project')

  expect(existsSync(join(pkg, 'ink-package.toml'))).toBe(true)
  expect(existsSync(join(pkg, 'scripts/main.ink'))).toBe(true)

  // No grammar or runtime scaffold
  expect(existsSync(join(pkg, 'src/grammar.ts'))).toBe(false)
  expect(existsSync(join(pkg, 'runtime'))).toBe(false)

  const manifest = TomlParser.read(join(pkg, 'ink-package.toml'))
  expect(manifest.name).toBe('my-project')
  expect(manifest.version).toBe('0.1.0')
  expect(manifest.main).toBe('main')
  expect(manifest.grammar).toBeUndefined()
  expect(manifest.runtime).toBeUndefined()

  const script = readFileSync(join(pkg, 'scripts/main.ink'), 'utf8')
  expect(script).toContain('my-project')
  expect(script).not.toContain('print')
})

it('scaffolds hello-world template', () => {
  execSync(
    `npx tsx ${CLI} new hello-project --template=hello-world`,
    { cwd: FIXTURES, encoding: 'utf8' }
  )
  const script = readFileSync(join(FIXTURES, 'hello-project/scripts/main.ink'), 'utf8')
  expect(script).toContain('print')
  expect(script).toContain('Hello')
})

it('scaffolds full template', () => {
  execSync(
    `npx tsx ${CLI} new full-project --template=full`,
    { cwd: FIXTURES, encoding: 'utf8' }
  )
  const script = readFileSync(join(FIXTURES, 'full-project/scripts/main.ink'), 'utf8')
  expect(script.split('\n').length).toBeGreaterThan(3)
})

it('defaults to blank template in non-TTY mode (no --template flag)', () => {
  execSync(
    `npx tsx ${CLI} new my-project`,
    { cwd: FIXTURES, encoding: 'utf8' }
  )
  const script = readFileSync(join(FIXTURES, 'my-project/scripts/main.ink'), 'utf8')
  expect(script).toContain('my-project')
  expect(script).not.toContain('print')
})

it('errors on unknown template', () => {
  expect(() =>
    execSync(
      `npx tsx ${CLI} new my-project --template=nonexistent`,
      { cwd: FIXTURES, encoding: 'utf8', stdio: 'pipe' }
    )
  ).toThrow()
})

it('errors when --template and --package are both given', () => {
  expect(() =>
    execSync(
      `npx tsx ${CLI} new my-project --template=blank --package`,
      { cwd: FIXTURES, encoding: 'utf8', stdio: 'pipe' }
    )
  ).toThrow()
})

it('errors if directory already exists (exits non-zero)', () => {
  mkdirSync(join(FIXTURES, 'existing-pkg'), { recursive: true })
  let threw = false
  try {
    execSync(
      `npx tsx ${CLI} new existing-pkg`,
      { cwd: FIXTURES, encoding: 'utf8', stdio: 'pipe' }
    )
  } catch (e: any) {
    threw = true
    expect(e.status).toBeGreaterThan(0)
    expect(e.stderr.toString()).toContain('already exists')
  }
  expect(threw).toBe(true)
})
```

- [ ] **Step 3: Run the tests to confirm they fail as expected**

```bash
cd /c/Users/justi/dev/quill && npx vitest run tests/commands/new.test.ts
```

Expected: the `--package` test fails (flag not recognized), new tests fail. This confirms the tests are driving real changes.

---

### Task 2: Update `cli.ts` to register new options

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `--package` and `--template` options to the `new` command**

Replace:
```ts
program.command('new <name>').description('Scaffold a new package').action(async (name) => {
  await new NewCommand(projectDir).run(name);
});
```

With:
```ts
program
  .command('new <name>')
  .description('Scaffold a new project or grammar package')
  .option('--package', 'scaffold a publishable grammar package with runtime')
  .option('--template <name>', 'use a named template (blank, hello-world, full)')
  .action(async (name, opts) => {
    if (opts.package && opts.template) {
      console.error('Error: --template and --package are mutually exclusive')
      process.exit(1)
    }
    if (opts.template && !['blank', 'hello-world', 'full'].includes(opts.template)) {
      console.error(`Error: Unknown template "${opts.template}". Available templates: blank, hello-world, full`)
      process.exit(1)
    }
    await new NewCommand(projectDir).run(name, { isPackage: !!opts.package, template: opts.template })
  })
```

- [ ] **Step 2: Run only the mutual-exclusion and unknown-template tests to confirm they pass now**

```bash
cd /c/Users/justi/dev/quill && npx vitest run tests/commands/new.test.ts -t "errors on unknown"
npx vitest run tests/commands/new.test.ts -t "errors when --template and --package"
```

Expected: both pass (CLI validation is done, even before NewCommand changes).

---

## Chunk 2: NewCommand rewrite

### Task 3: Rewrite `NewCommand` to support script and package paths

**Files:**
- Modify: `src/commands/new.ts`

The current implementation only has the package path. We need to add the script path and a `promptTemplate()` wizard. The package path stays untouched.

- [ ] **Step 1: Confirm `PackageManifest.main` accepts a free string**

Open `src/model/manifest.ts` and verify `main: string` (not an enum). It does — no change needed.

- [ ] **Step 2: Replace `new.ts` with the new implementation**

```ts
import { TomlParser } from '../util/toml.js';
import { PackageManifest } from '../model/manifest.js';
import { readRc, fingerprint } from '../util/keys.js';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

const TEMPLATES = ['blank', 'hello-world', 'full'] as const;
type Template = typeof TEMPLATES[number];

function templateContent(name: string, template: Template): string {
  switch (template) {
    case 'blank':
      return `// ${name}\n`;
    case 'hello-world':
      return `print("Hello, world!")\n`;
    case 'full':
      return `// ${name} v0.1.0\n\nfn greet(name) {\n  print("Hello, " + name + "!")\n}\n\ngreet("world")\n`;
  }
}

async function promptTemplate(name: string): Promise<Template> {
  // Non-TTY: default to blank
  if (!process.stdin.isTTY) return 'blank';

  // Show logged-in status
  try {
    const rc = readRc();
    if (rc.privateKey && rc.publicKey) {
      console.log(`Logged in (fingerprint: ${fingerprint(rc.publicKey)})`);
    }
  } catch {}

  console.log('\n? Select a template:');
  console.log('  [1] blank        — empty project');
  console.log('  [2] hello-world  — starter script');
  console.log('  [3] full         — example project');

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = () => {
      rl.question('\nEnter number (default: 1): ', (answer) => {
        const t = answer.trim();
        if (t === '' || t === '1') { rl.close(); resolve('blank'); }
        else if (t === '2') { rl.close(); resolve('hello-world'); }
        else if (t === '3') { rl.close(); resolve('full'); }
        else { ask(); }
      });
    };
    ask();
  });
}

export interface NewCommandOptions {
  isPackage: boolean;
  template?: string;
}

export class NewCommand {
  constructor(private projectDir: string) {}

  async run(name: string, opts: NewCommandOptions = { isPackage: false }): Promise<void> {
    const targetDir = path.join(this.projectDir, name);
    if (fs.existsSync(targetDir)) {
      console.error(`Error: Directory already exists: ${name}/`);
      process.exit(1);
    }

    if (opts.isPackage) {
      await this.scaffoldPackage(name, targetDir);
    } else {
      const template = (opts.template as Template | undefined) ?? await promptTemplate(name);
      await this.scaffoldProject(name, targetDir, template);
    }
  }

  private async scaffoldProject(name: string, targetDir: string, template: Template): Promise<void> {
    fs.mkdirSync(targetDir, { recursive: true });

    // Resolve author from ~/.quillrc — requires BOTH keys to be present
    let author: string | undefined;
    try {
      const rc = readRc();
      if (rc.privateKey && rc.publicKey) {
        author = fingerprint(rc.publicKey);
      }
    } catch {}

    const manifest: PackageManifest = {
      name,
      version: '0.1.0',
      main: 'main',        // always the string "main" — stem of scripts/main.ink
      dependencies: {},
      ...(author ? { author } : {}),
    };

    fs.writeFileSync(
      path.join(targetDir, 'ink-package.toml'),
      TomlParser.write(manifest)
    );

    fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'scripts/main.ink'),
      templateContent(name, template)
    );

    console.log(`Created project: ${name}/`);
    console.log('  ink-package.toml');
    console.log('  scripts/main.ink');
  }

  private async scaffoldPackage(name: string, targetDir: string): Promise<void> {
    fs.mkdirSync(targetDir, { recursive: true });

    const className = name
      .split(/[.\-]/)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');

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

    fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'src/grammar.ts'),
      `import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'\n\nexport default defineGrammar({\n  package: '${name}',\n  declarations: [\n    declaration({\n      keyword: 'mykeyword',\n      inheritsBase: true,\n      rules: [\n        rule('my_rule', r => r.identifier())\n      ]\n    })\n  ]\n})\n`
    );

    fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'scripts/main.ink'),
      `// ${name} v0.1.0\n`
    );

    const runtimeDir = path.join(targetDir, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'build.gradle.kts'),
      `plugins {\n    kotlin("jvm") version "1.9.22"\n}\n\ngroup = "${name}"\nversion = "0.1.0"\n\nrepositories {\n    mavenCentral()\n}\n\ndependencies {\n    compileOnly("io.papermc.paper:paper-api:1.20.4-R0.1-SNAPSHOT")\n}\n\nkotlin {\n    jvmToolchain(17)\n}\n`
    );

    const ktDir = path.join(runtimeDir, 'src/main/kotlin');
    fs.mkdirSync(ktDir, { recursive: true });
    fs.writeFileSync(
      path.join(ktDir, `${className}Runtime.kt`),
      `package ${name}\n\nclass ${className}Runtime {\n    // Implement InkRuntimePackage interface here\n}\n`
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

- [ ] **Step 2: Run all `new` tests**

```bash
cd /c/Users/justi/dev/quill && npx vitest run tests/commands/new.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
cd /c/Users/justi/dev/quill && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/justi/dev/quill
git add src/commands/new.ts src/cli.ts tests/commands/new.test.ts
git commit -m "feat: add script project template picker to quill new

quill new <name> now scaffolds a minimal script project (no grammar or
runtime) with a template picker (blank / hello-world / full). The
previous grammar+runtime scaffold moves to quill new <name> --package.
Use --template=<name> to skip the interactive wizard."
```
