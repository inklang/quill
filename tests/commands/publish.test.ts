import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect } from 'vitest'
import { platform } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.ts')
const FIXTURE = join(__dirname, '../fixtures/grammar-project')

describe('quill publish', () => {
  // Skipped on Windows: os.homedir() ignores HOME=/tmp/no-home and falls back to
  // the real user profile, so ~/.quillrc is found and auth check passes → 404 instead of "Not logged in"
  it.skipIf(platform() === 'win32')('errors when no auth token is set', () => {
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
