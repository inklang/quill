import { writeFileSync, rmSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer, type Server } from 'http'
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { OutdatedCommand } from '../../src/commands/outdated.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('quill outdated', () => {
  const TMP = join(__dirname, '../fixtures/.tmp-outdated-test')
  let server: Server
  let registryUrl: string
  let originalEnv: string | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/index.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          packages: {
            'ink.test': {
              '0.1.0': { url: 'http://example.com/ink.test-0.1.0.tar.gz' },
              '0.2.0': { url: 'http://example.com/ink.test-0.2.0.tar.gz' },
              '0.3.0': { url: 'http://example.com/ink.test-0.3.0.tar.gz' },
            }
          }
        }))
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

  it('shows no dependencies message when no deps', async () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'),
      `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n\n[dependencies]\n`)

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: any[]) => logs.push(args.join(' '))
    try {
      const cmd = new OutdatedCommand(TMP)
      await cmd.run()
    } finally {
      console.log = origLog
    }
    expect(logs.join('\n')).toContain('No dependencies to check')
  })

  it('reports outdated when newer version exists', async () => {
    mkdirSync(TMP, { recursive: true })
    mkdirSync(join(TMP, 'packages', 'ink.test'), { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'),
      `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n\n[dependencies]\n"ink.test" = "^0.1.0"\n`)
    writeFileSync(join(TMP, 'packages', 'ink.test', 'ink-package.toml'),
      `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n`)

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: any[]) => logs.push(args.join(' '))
    try {
      const cmd = new OutdatedCommand(TMP)
      await cmd.run()
    } finally {
      console.log = origLog
    }
    const output = logs.join('\n')
    expect(output).toContain('ink.test')
    expect(output).toContain('current: 0.1.0')
    expect(output).toContain('latest:  0.3.0')
  })

  it('reports all up to date when installed version is latest', async () => {
    mkdirSync(TMP, { recursive: true })
    mkdirSync(join(TMP, 'packages', 'ink.test'), { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'),
      `[package]\nname = "ink.test"\nversion = "0.1.0"\nmain = "mod"\n\n[dependencies]\n"ink.test" = "^0.3.0"\n`)
    writeFileSync(join(TMP, 'packages', 'ink.test', 'ink-package.toml'),
      `[package]\nname = "ink.test"\nversion = "0.3.0"\nmain = "mod"\n`)

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: any[]) => logs.push(args.join(' '))
    try {
      const cmd = new OutdatedCommand(TMP)
      await cmd.run()
    } finally {
      console.log = origLog
    }
    expect(logs.join('\n')).toContain('All dependencies are up to date')
  })
})
