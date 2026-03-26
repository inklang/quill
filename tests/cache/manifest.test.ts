import { describe, it, expect, beforeEach } from 'vitest'
import { CacheManifestStore, CacheManifest } from '../../src/cache/manifest.js'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('CacheManifestStore', () => {
  let tmp: string
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'quill-cache-test-')) })

  it('read returns null when manifest does not exist', () => {
    const store = new CacheManifestStore(join(tmp, 'cache'))
    expect(store.read()).toBeNull()
  })

  it('write then read returns the manifest', () => {
    const store = new CacheManifestStore(join(tmp, 'cache'))
    const manifest: CacheManifest = {
      version: 1,
      lastFullBuild: '2026-03-25T12:00:00.000Z',
      grammarIrHash: 'abc123',
      entries: {
        'scripts/hello.ink': {
          hash: 'def456',
          output: 'hello.inkc',
          compiledAt: '2026-03-25T12:00:01.000Z',
        },
      },
    }
    store.write(manifest)
    const read = store.read()
    expect(read).toEqual(manifest)
  })

  it('read returns null for invalid JSON', () => {
    const cacheDir = join(tmp, 'cache')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'manifest.json'), 'not json')
    const store = new CacheManifestStore(cacheDir)
    expect(store.read()).toBeNull()
  })
})
