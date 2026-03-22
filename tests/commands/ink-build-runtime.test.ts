// tests/commands/ink-build-runtime.test.ts
import { execSync } from 'child_process'
import { readFileSync, rmSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, beforeEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const RUNTIME_FIXTURE = join(__dirname, '../fixtures/runtime-project')
const SCRIPTS_FIXTURE = join(__dirname, '../fixtures/scripts-only-project')

describe('ink build with [runtime]', () => {
  beforeEach(() => {
    try { rmSync(join(RUNTIME_FIXTURE, 'dist'), { recursive: true }) } catch {}
  })

  it('copies runtime jar to dist and writes ink-manifest.json', () => {
    const result = execSync(
      `npx tsx ${CLI} build`,
      { cwd: RUNTIME_FIXTURE, encoding: 'utf8' }
    )
    expect(result).toContain('Runtime jar copied to dist/mobs-runtime.jar')
    expect(result).toContain('Wrote dist/ink-manifest.json')

    // Jar was copied
    expect(existsSync(join(RUNTIME_FIXTURE, 'dist/mobs-runtime.jar'))).toBe(true)

    // ink-manifest.json has both grammar and runtime
    const manifest = JSON.parse(readFileSync(join(RUNTIME_FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.name).toBe('ink.mobs')
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.grammar).toBe('grammar.ir.json')
    expect(manifest.runtime.jar).toBe('mobs-runtime.jar')
    expect(manifest.runtime.entry).toBe('org.ink.mobs.MobsRuntime')
  })

  it('fails when runtime jar is missing', () => {
    // Create a temp project with a [runtime] pointing to a nonexistent jar
    const tmpFixture = join(__dirname, '../fixtures/runtime-missing-jar')
    mkdirSync(tmpFixture, { recursive: true })
    writeFileSync(join(tmpFixture, 'ink-package.toml'), `
[package]
name = "ink.bad"
version = "0.1.0"
main = "mod"

[dependencies]

[runtime]
jar = "runtime/does-not-exist.jar"
entry = "org.ink.bad.BadRuntime"
`)
    try {
      execSync(`npx tsx ${CLI} build`, { cwd: tmpFixture, encoding: 'utf8', stdio: 'pipe' })
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e.stderr.toString()).toContain('Runtime jar not found')
    } finally {
      rmSync(tmpFixture, { recursive: true })
    }
  })
})

describe('ink build scripts-only package', () => {
  beforeEach(() => {
    try { rmSync(join(SCRIPTS_FIXTURE, 'dist'), { recursive: true }) } catch {}
  })

  it('writes ink-manifest.json with name and version only', () => {
    const result = execSync(
      `npx tsx ${CLI} build`,
      { cwd: SCRIPTS_FIXTURE, encoding: 'utf8' }
    )
    expect(result).toContain('Wrote dist/ink-manifest.json')

    const manifest = JSON.parse(readFileSync(join(SCRIPTS_FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.name).toBe('ink.scripts')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.grammar).toBeUndefined()
    expect(manifest.runtime).toBeUndefined()
  })
})
