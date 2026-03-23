// tests/commands/ink-build-compile.test.ts
import { execSync } from 'child_process'
import { readFileSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, beforeEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const FIXTURE = join(__dirname, '../fixtures/scripts-compile-project')
const MOCK_JAVA = join(FIXTURE, 'mock-java.sh')

describe('ink build .ink compilation', () => {
  beforeEach(() => {
    try { rmSync(join(FIXTURE, 'dist'), { recursive: true }) } catch {}
  })

  it('compiles .ink files to .inkc in dist/scripts/', () => {
    const result = execSync(
      `npx tsx ${CLI} build`,
      { cwd: FIXTURE, encoding: 'utf8', env: { ...process.env, INK_COMPILER: '/tmp/fake-compiler.jar', INK_JAVA: MOCK_JAVA } }
    )
    expect(result).toContain('Compiled 1 script')

    expect(existsSync(join(FIXTURE, 'dist/scripts/main.inkc'))).toBe(true)

    const manifest = JSON.parse(readFileSync(join(FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.scripts).toContain('main.inkc')
  })

  it('skips compilation when no scripts/ directory exists', () => {
    const grammarFixture = join(__dirname, '../fixtures/grammar-project')

    const result = execSync(
      `npx tsx ${CLI} build`,
      { cwd: grammarFixture, encoding: 'utf8' }
    )
    expect(result).toContain('Wrote dist/ink-manifest.json')

    const manifest = JSON.parse(readFileSync(join(grammarFixture, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.scripts).toBeUndefined()
  })

  it('errors when INK_COMPILER is not set and scripts exist', () => {
    try {
      execSync(
        `npx tsx ${CLI} build`,
        { cwd: FIXTURE, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, INK_COMPILER: '', INK_JAVA: '' } }
      )
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e.stderr.toString()).toContain('Ink compiler not found')
    }
  })
})
