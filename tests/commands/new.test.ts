// tests/commands/new.test.ts
import { execSync } from 'child_process'
import { readFileSync, existsSync, rmSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, afterEach } from 'vitest'
import { TomlParser } from '../../src/util/toml.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.ts')
const FIXTURES = join(__dirname, '../fixtures')

describe('quill new', () => {
  afterEach(() => {
    for (const name of ['ink.mobs', 'existing-pkg', 'my-project', 'hello-project', 'full-project', 'bad-template-project', 'conflict-project']) {
      try { rmSync(join(FIXTURES, name), { recursive: true }) } catch {}
    }
  })

  it('scaffolds full package with grammar + runtime + gradle', () => {
    const result = execSync(
      `npx tsx ${CLI} new ink.mobs --package`,
      { cwd: FIXTURES, encoding: 'utf8' }
    )

    const pkg = join(FIXTURES, 'ink.mobs')

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

  it('scaffolds minimal script project with --template=blank', () => {
    execSync(
      `npx tsx ${CLI} new my-project --template=blank`,
      { cwd: FIXTURES, encoding: 'utf8' }
    )
    const pkg = join(FIXTURES, 'my-project')

    expect(existsSync(join(pkg, 'ink-package.toml'))).toBe(true)
    expect(existsSync(join(pkg, 'scripts/main.ink'))).toBe(true)
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
    expect(script).toContain('fn ')
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
    let threw = false
    try {
      execSync(
        `npx tsx ${CLI} new bad-template-project --template=nonexistent`,
        { cwd: FIXTURES, encoding: 'utf8', stdio: 'pipe' }
      )
    } catch (e: any) {
      threw = true
      expect(e.status).toBeGreaterThan(0)
      expect(e.stderr.toString()).toContain('Unknown template')
    }
    expect(threw).toBe(true)
  })

  it('errors when --template and --package are both given', () => {
    let threw = false
    try {
      execSync(
        `npx tsx ${CLI} new conflict-project --template=blank --package`,
        { cwd: FIXTURES, encoding: 'utf8', stdio: 'pipe' }
      )
    } catch (e: any) {
      threw = true
      expect(e.status).toBeGreaterThan(0)
      expect(e.stderr.toString()).toContain('mutually exclusive')
    }
    expect(threw).toBe(true)
  })
})
