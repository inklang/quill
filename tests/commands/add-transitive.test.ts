import { writeFileSync, rmSync, mkdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer, type Server } from 'http'
import * as os from 'os'
import * as tar from 'tar'
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { AddCommand } from '../../src/commands/add.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TMP = join(__dirname, '../fixtures/.tmp-add-transitive-test')

describe('quill add transitive', () => {
  let server: Server
  let registryUrl: string
  let originalEnv: string | undefined

  // Pre-build minimal valid tar.gz buffers
  const tarballBuffers = new Map<string, Buffer>()

  beforeAll(async () => {
    for (const name of ['ink.mobs-1.0.0', 'ink.utils-1.0.0', 'ink.utils-1.5.0']) {
      const tmpDir = join(os.tmpdir(), `_quill-tarball-${name}`)
      rmSync(tmpDir, { recursive: true, force: true })
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(join(tmpDir, 'ink-manifest.json'), JSON.stringify({ name, version: '1.0.0' }))
      const tarPath = join(tmpDir, `${name}.tar.gz`)
      await tar.c({ gzip: true, file: tarPath, cwd: tmpDir }, ['ink-manifest.json'])
      tarballBuffers.set(name, readFileSync(tarPath))
      rmSync(tmpDir, { recursive: true, force: true })
    }

    server = createServer((req, res) => {
      if (req.url === '/index.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          packages: {
            'ink.mobs': {
              '1.0.0': {
                url: `${registryUrl}/tarballs/ink.mobs-1.0.0`,
                dependencies: { 'ink.utils': '^1.0.0' },
                description: 'Mob framework',
              }
            },
            'ink.utils': {
              '1.0.0': {
                url: `${registryUrl}/tarballs/ink.utils-1.0.0`,
                dependencies: {},
                description: 'Utilities',
              },
              '1.5.0': {
                url: `${registryUrl}/tarballs/ink.utils-1.5.0`,
                dependencies: {},
                description: 'Utilities',
              }
            }
          }
        }))
      } else if (req.url?.startsWith('/tarballs/')) {
        const key = req.url.replace('/tarballs/', '')
        const buf = tarballBuffers.get(key)
        if (buf) {
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
          res.end(buf)
        } else {
          res.writeHead(404)
          res.end('Not found')
        }
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

  it('resolves transitive dependencies when adding a package', async () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'ink-package.toml'), [
      `[package]`,
      `name = "ink.test"`,
      `version = "0.1.0"`,
      `main = "mod"`,
      ``,
      `[dependencies]`,
    ].join('\n'))

    const logs: string[] = []
    const origLog = console.log
    const origError = console.error
    console.log = (...args: any[]) => logs.push(args.join(' '))
    console.error = (...args: any[]) => logs.push(args.join(' '))
    try {
      const cmd = new AddCommand(TMP)
      await cmd.run('ink.mobs', { force: true })
    } finally {
      console.log = origLog
      console.error = origError
    }

    // Check lock file has both packages
    const lock = JSON.parse(readFileSync(join(TMP, 'quill.lock'), 'utf-8'))
    expect(lock.packages).toHaveProperty('ink.mobs@1.0.0')
    expect(lock.packages).toHaveProperty('ink.utils@1.5.0')
    expect(lock.packages['ink.mobs@1.0.0'].dependencies).toEqual(['ink.utils@1.5.0'])
    expect(lock.packages['ink.utils@1.5.0'].dependencies).toEqual([])
  })
})
