// tests/commands/ink-build-import.test.ts
import { execSync } from 'child_process'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const FIXTURE_DIR = join(__dirname, '../fixtures/import-project')
const COMPILER = join(__dirname, '../../compiler/printing_press.exe')

describe('ink-build entry-point import resolution', () => {
  beforeEach(() => {
    try { rmSync(join(FIXTURE_DIR, 'dist'), { recursive: true }) } catch {}
    try { rmSync(join(FIXTURE_DIR, '.quill'), { recursive: true }) } catch {}
  })

  afterEach(() => {
    try { rmSync(join(FIXTURE_DIR, 'dist'), { recursive: true }) } catch {}
    try { rmSync(join(FIXTURE_DIR, '.quill'), { recursive: true }) } catch {}
  })

  it('compiles entry point with imports into single inkc', () => {
    const output = execSync(`npx tsx ${CLI} build --full`, {
      cwd: FIXTURE_DIR,
      encoding: 'utf8',
      env: { ...process.env, INK_COMPILER: COMPILER },
    })

    expect(output).toContain('Compiling from entry point')

    const inkcPath = join(FIXTURE_DIR, 'dist/scripts/main.inkc')
    expect(existsSync(inkcPath)).toBe(true)

    const inkc = JSON.parse(readFileSync(inkcPath, 'utf8'))
    const chunk = inkc.chunk ?? inkc

    // Should be valid compiled output with code
    expect(chunk.code).toBeDefined()
    expect(Array.isArray(chunk.code)).toBe(true)
    expect(chunk.code.length).toBeGreaterThan(0)
  })

  it('produces only main.inkc in scripts output', () => {
    execSync(`npx tsx ${CLI} build --full`, {
      cwd: FIXTURE_DIR,
      encoding: 'utf8',
      env: { ...process.env, INK_COMPILER: COMPILER },
    })

    const manifestPath = join(FIXTURE_DIR, 'dist/ink-manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

    expect(manifest.scripts).toEqual(['main.inkc'])
  })
})
