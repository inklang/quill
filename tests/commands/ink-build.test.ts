// tests/commands/ink-build.test.ts
import { execSync } from 'child_process'
import { readFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, beforeAll } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, '../fixtures/grammar-project')

beforeAll(() => {
  try { rmSync(join(FIXTURE, 'dist'), { recursive: true }) } catch {}
})

it('ink build produces grammar.ir.json', () => {
  const result = execSync(
    `npx tsx ${join(__dirname, '../../src/cli.js')} build`,
    { cwd: FIXTURE, encoding: 'utf8' }
  )
  expect(result).toContain('Grammar IR written to')

  const irPath = join(FIXTURE, 'dist/grammar.ir.json')
  const ir = JSON.parse(readFileSync(irPath, 'utf8'))
  expect(ir.version).toBe(1)
  expect(ir.package).toBe('ink.test')
  expect(ir.keywords).toContain('entity')
  expect(ir.keywords).toContain('spawn')
  expect(ir.declarations[0].keyword).toBe('entity')

  // ink-manifest.json should be written with grammar only
  const manifest = JSON.parse(readFileSync(join(FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
  expect(manifest.name).toBe('ink.test')
  expect(manifest.version).toBe('0.1.0')
  expect(manifest.grammar).toBe('grammar.ir.json')
  expect(manifest.runtime).toBeUndefined()
})
