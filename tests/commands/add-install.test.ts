import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer, type Server } from 'http'
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { InstallCommand } from '../../src/commands/install.js'
import { AddCommand } from '../../src/commands/add.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('quill add / install', () => {
  const TMP = join(__dirname, '../fixtures/.tmp-add-test')
  let server: Server
  let registryUrl: string
  let originalEnv: string | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/index.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ packages: {} }))
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address() as { port: number }
    registryUrl = `http://127.0.0.1:${addr.port}`
    originalEnv = process.env['LECTERN_REGISTRY']
    process.env['LECTERN_REGISTRY'] = registryUrl
  })

  afterAll(async () => {
    if (originalEnv !== undefined) process.env['LECTERN_REGISTRY'] = originalEnv
    else delete process.env['LECTERN_REGISTRY']
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  afterEach(() => {
    try { rmSync(TMP, { recursive: true }) } catch {}
  })

  it('add errors gracefully when package not found in registry', async () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'), `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n\n[dependencies]\n`)

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: any[]) => logs.push(args.join(' '))
    try {
      const cmd = new AddCommand(TMP)
      await cmd.run('nonexistent-pkg')
    } finally {
      console.log = origLog
    }
    expect(logs.join('\n')).toContain('No version of nonexistent-pkg')
  })

  it('install with no dependencies succeeds', async () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'), `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n\n[dependencies]\n`)

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: any[]) => logs.push(args.join(' '))
    try {
      const cmd = new InstallCommand(TMP)
      await cmd.run()
    } finally {
      console.log = origLog
    }
    expect(logs.join('\n')).toContain('No dependencies to install.')
    expect(existsSync(join(TMP, 'quill.lock'))).toBe(true)
  })
})
