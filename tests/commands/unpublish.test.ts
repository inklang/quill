import { writeFileSync, rmSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer, type Server } from 'http'
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { UnpublishCommand } from '../../src/commands/unpublish.js'
import { readRc } from '../../src/util/keys.js'
import path from 'path'
import os from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('quill unpublish', () => {
  const TMP = join(__dirname, '../fixtures/.tmp-unpublish-test')
  let server: Server
  let registryUrl: string
  let originalEnv: string | undefined
  let originalRcPath: string

  beforeAll(async () => {
    // Save and override ~/.quillrc to a temp location
    originalRcPath = path.join(os.homedir(), '.quillrc')
    try {
      const stat = require('fs').statSync(originalRcPath)
      const content = require('fs').readFileSync(originalRcPath, 'utf8')
      ;(global as any).__savedQuillRc = { content, exists: true }
    } catch {
      ;(global as any).__savedQuillRc = { exists: false }
    }

    server = createServer((req, res) => {
      // Verify auth header is sent
      const auth = req.headers['authorization']
      if (!auth || !auth.startsWith('Bearer test-token-')) {
        res.writeHead(401, { 'Content-Type': 'text/plain' })
        res.end('Unauthorized')
        return
      }
      if (req.method === 'DELETE' && req.url?.startsWith('/api/packages/')) {
        res.writeHead(204)
        res.end()
        return
      }
      res.writeHead(404)
      res.end('Not found')
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address() as { port: number }
    registryUrl = `http://127.0.0.1:${addr.port}`
    originalEnv = process.env['LECTERN_REGISTRY']
    process.env['LECTERN_REGISTRY'] = registryUrl

    // Write a fake quillrc with test credentials
    require('fs').writeFileSync(originalRcPath,
      JSON.stringify({ token: 'test-token-abc', username: 'testuser', registry: registryUrl }))
  })

  afterAll(async () => {
    if (originalEnv !== undefined) process.env['LECTERN_REGISTRY'] = originalEnv
    else delete process.env['LECTERN_REGISTRY']
    await new Promise<void>((resolve) => server.close(() => resolve()))

    // Restore original quillrc
    const saved = (global as any).__savedQuillRc
    if (saved.exists) {
      require('fs').writeFileSync(originalRcPath, saved.content)
    } else {
      try { require('fs').unlinkSync(originalRcPath) } catch {}
    }
  })

  afterEach(() => {
    try { rmSync(TMP, { recursive: true }) } catch {}
  })

  it('errors when not logged in', async () => {
    // Temporarily remove quillrc to test auth error
    const tmpRc = path.join(os.homedir(), '.quillrc')
    const backup = require('fs').existsSync(tmpRc)
      ? require('fs').readFileSync(tmpRc, 'utf8')
      : null
    require('fs').unlinkSync(tmpRc)

    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'),
      `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n`)

    const errors: string[] = []
    const origErr = console.error
    console.error = (...args: any[]) => errors.push(args.join(' '))
    try {
      const cmd = new UnpublishCommand(TMP)
      await cmd.run()
    } catch {}
    finally {
      console.error = origErr
      if (backup) require('fs').writeFileSync(tmpRc, backup)
    }
    expect(errors.join('\n')).toContain('Not logged in')
  })

  it('unpublishes the current version when no version arg given', async () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'),
      `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n`)

    const cmd = new UnpublishCommand(TMP)
    await cmd.run()
    // Server responds 204 — no error means success
  })

  it('unpublishes a specific version when provided', async () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'),
      `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n`)

    const cmd = new UnpublishCommand(TMP)
    await cmd.run('0.2.0')
    // Server responds 204 — no error means success
  })
})
