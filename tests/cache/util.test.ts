import { describe, it, expect, beforeEach } from 'vitest'
import { hashFile, findDirtyFiles, buildManifest } from '../../src/cache/util.js'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('hashFile', () => {
  it('returns consistent SHA-256 hash', () => {
    const t = mkdtempSync(join(tmpdir(), 'quill-util-test-'))
    writeFileSync(join(t, 'test.ink'), 'Hello, world!')
    const h1 = hashFile(join(t, 'test.ink'))
    const h2 = hashFile(join(t, 'test.ink'))
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64) // SHA-256 hex
  })

  it('different content produces different hash', () => {
    const t = mkdtempSync(join(tmpdir(), 'quill-util-test-'))
    writeFileSync(join(t, 'a.ink'), 'content a')
    writeFileSync(join(t, 'b.ink'), 'content b')
    expect(hashFile(join(t, 'a.ink'))).not.toBe(hashFile(join(t, 'b.ink')))
  })
})

describe('findDirtyFiles', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'quill-util-test-'))
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
  })

  it('returns all files as dirty when no manifest exists', () => {
    writeFileSync(join(tmp, 'scripts', 'hello.ink'), 'hello')
    writeFileSync(join(tmp, 'scripts', 'fight.ink'), 'fight')
    const dirty = findDirtyFiles(tmp, join(tmp, 'scripts'), null)
    expect(dirty).toHaveLength(2)
    expect(dirty.map(d => d.relativePath)).toContain('scripts/hello.ink')
    expect(dirty.map(d => d.relativePath)).toContain('scripts/fight.ink')
  })

  it('returns only changed files as dirty', () => {
    writeFileSync(join(tmp, 'scripts', 'hello.ink'), 'hello')
    const dirty = findDirtyFiles(tmp, join(tmp, 'scripts'), null)
    const helloHash = dirty[0].hash

    const manifest = {
      version: 1 as const,
      lastFullBuild: new Date().toISOString(),
      grammarIrHash: null,
      entries: {
        'scripts/hello.ink': { hash: helloHash, output: 'hello.inkc', compiledAt: new Date().toISOString() },
      },
    }

    writeFileSync(join(tmp, 'scripts', 'fight.ink'), 'fight')
    const dirty2 = findDirtyFiles(tmp, join(tmp, 'scripts'), manifest)
    expect(dirty2).toHaveLength(1)
    expect(dirty2[0].relativePath).toBe('scripts/fight.ink')
  })

  it('returns modified file as dirty', () => {
    writeFileSync(join(tmp, 'scripts', 'hello.ink'), 'original')
    const dirty = findDirtyFiles(tmp, join(tmp, 'scripts'), null)
    const originalHash = dirty[0].hash

    writeFileSync(join(tmp, 'scripts', 'hello.ink'), 'modified')

    const manifest = {
      version: 1 as const,
      lastFullBuild: new Date().toISOString(),
      grammarIrHash: null,
      entries: {
        'scripts/hello.ink': { hash: originalHash, output: 'hello.inkc', compiledAt: new Date().toISOString() },
      },
    }

    const dirty2 = findDirtyFiles(tmp, join(tmp, 'scripts'), manifest)
    expect(dirty2).toHaveLength(1)
    expect(dirty2[0].relativePath).toBe('scripts/hello.ink')
  })
})

describe('buildManifest', () => {
  it('builds a valid manifest', () => {
    const dirtyFiles = [{ relativePath: 'scripts/hello.ink', hash: 'abc123' }]
    const manifest = buildManifest('2026-03-25T12:00:00Z', 'grammarhash', null, dirtyFiles)
    expect(manifest.version).toBe(1)
    expect(manifest.entries['scripts/hello.ink'].hash).toBe('abc123')
    expect(manifest.entries['scripts/hello.ink'].output).toBe('scripts/hello.inkc')
  })
})
