import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.ts')
const FIXTURE = join(__dirname, '../fixtures/grammar-project')

describe('quill publish', () => {
  it('errors when no auth token is set', () => {
    try {
      execSync(
        `npx tsx ${CLI} publish`,
        {
          cwd: FIXTURE,
          encoding: 'utf8',
          stdio: 'pipe',
          env: { ...process.env, QUILL_TOKEN: '', HOME: '/tmp/no-home' }
        }
      )
      expect.unreachable('should have thrown')
    } catch (e: any) {
      const output = e.stderr.toString()
      expect(output).toContain('Not logged in. Run `quill login` first.')
    }
  })
})
