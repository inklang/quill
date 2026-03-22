// tests/commands/new.test.ts
import { execSync } from 'child_process'
import { readFileSync, existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, afterEach } from 'vitest'
import { TomlParser } from '../../src/util/toml.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.ts')
const FIXTURES = join(__dirname, '../fixtures')

describe('quill new', () => {
  afterEach(() => {
    try { rmSync(join(FIXTURES, 'ink.mobs'), { recursive: true }) } catch {}
    try { rmSync(join(FIXTURES, 'existing-pkg'), { recursive: true }) } catch {}
  })

  it('scaffolds full package with grammar + runtime + gradle', () => {
    const result = execSync(
      `npx tsx ${CLI} new ink.mobs`,
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

  it('rejects if directory already exists', async () => {
    const { mkdirSync } = await import('fs')
    const pkg = join(FIXTURES, 'existing-pkg')
    mkdirSync(pkg, { recursive: true })
    try {
      execSync(
        `npx tsx ${CLI} new existing-pkg`,
        { cwd: FIXTURES, encoding: 'utf8', stdio: 'pipe' }
      )
    } catch (e: any) {
      expect(e.stderr.toString()).toContain('already exists')
    }
  })
})
