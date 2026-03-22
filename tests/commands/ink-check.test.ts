// tests/commands/ink-check.test.ts
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { it, expect } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, '../fixtures/grammar-project')

it('ink check passes valid grammar', () => {
  const result = execSync(
    `npx tsx ${join(__dirname, '../../src/cli.js')} check`,
    { cwd: FIXTURE, encoding: 'utf8' }
  )
  expect(result).toContain('Grammar OK')
})
