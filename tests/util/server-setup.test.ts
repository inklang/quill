import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ensureServerDir, resolveServerDir } from '../../src/util/server-setup.js'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'

describe('ensureServerDir', () => {
  const tmpDir = join(os.tmpdir(), 'quill-server-setup-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates server directory with eula.txt and plugins structure', () => {
    ensureServerDir(tmpDir)
    expect(existsSync(tmpDir)).toBe(true)
    expect(readFileSync(join(tmpDir, 'eula.txt'), 'utf-8')).toBe('eula=true\n')
    expect(existsSync(join(tmpDir, 'plugins', 'Ink', 'scripts'))).toBe(true)
    expect(existsSync(join(tmpDir, 'plugins', 'Ink', 'plugins'))).toBe(true)
  })

  it('does not overwrite existing eula.txt', () => {
    ensureServerDir(tmpDir)
    const eulaPath = join(tmpDir, 'eula.txt')
    writeFileSync(eulaPath, 'eula=false\n')
    ensureServerDir(tmpDir)
    expect(readFileSync(eulaPath, 'utf-8')).toBe('eula=false\n')
  })

  it('is idempotent — safe to call multiple times', () => {
    ensureServerDir(tmpDir)
    ensureServerDir(tmpDir)
    ensureServerDir(tmpDir)
    expect(existsSync(join(tmpDir, 'eula.txt'))).toBe(true)
    expect(existsSync(join(tmpDir, 'plugins', 'Ink', 'scripts'))).toBe(true)
  })

  it('does not create server.properties', () => {
    ensureServerDir(tmpDir)
    expect(existsSync(join(tmpDir, 'server.properties'))).toBe(false)
  })
})

describe('resolveServerDir', () => {
  it('resolves relative path against projectDir', () => {
    const result = resolveServerDir('/project', { server: { path: '.' } })
    expect(result).toBe(join('/project', '.'))
  })

  it('resolves relative subdirectory path', () => {
    const result = resolveServerDir('/project', { server: { path: './server' } })
    expect(result).toBe(join('/project', './server'))
  })

  it('uses absolute path as-is', () => {
    const result = resolveServerDir('/project', { server: { path: '/opt/minecraft/myserver' } })
    expect(result).toBe('/opt/minecraft/myserver')
  })

  it('falls back to ~/.quill/server/<target> when no server path', () => {
    const result = resolveServerDir('/project', { build: { target: 'paper' } })
    expect(result).toBe(join(os.homedir(), '.quill', 'server', 'paper'))
  })

  it('defaults target to "paper" when no build config', () => {
    const result = resolveServerDir('/project', {})
    expect(result).toBe(join(os.homedir(), '.quill', 'server', 'paper'))
  })
})
