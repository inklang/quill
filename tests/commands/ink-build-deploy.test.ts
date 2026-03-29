import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { deployScripts, deployGrammarJars } from '../../src/commands/run.js'

describe('quill build deploy step', () => {
  const tmpDir = join(os.tmpdir(), 'quill-build-deploy-test')
  const projectDir = join(tmpDir, 'project')
  const serverDir = join(tmpDir, 'server')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(join(projectDir, 'dist', 'scripts'), { recursive: true })
    mkdirSync(join(serverDir, 'plugins', 'Ink', 'scripts'), { recursive: true })
    mkdirSync(join(serverDir, 'plugins', 'Ink', 'plugins'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deploys compiled scripts to server plugins dir', () => {
    writeFileSync(join(projectDir, 'dist', 'scripts', 'main.inkc'), 'bytecode-here')
    deployScripts(serverDir, projectDir)
    expect(existsSync(join(serverDir, 'plugins', 'Ink', 'scripts', 'main.inkc'))).toBe(true)
  })

  it('clears stale scripts before deploying', () => {
    writeFileSync(join(serverDir, 'plugins', 'Ink', 'scripts', 'old.inkc'), 'stale')
    writeFileSync(join(projectDir, 'dist', 'scripts', 'main.inkc'), 'fresh')
    deployScripts(serverDir, projectDir)
    expect(existsSync(join(serverDir, 'plugins', 'Ink', 'scripts', 'old.inkc'))).toBe(false)
    expect(existsSync(join(serverDir, 'plugins', 'Ink', 'scripts', 'main.inkc'))).toBe(true)
  })

  it('deploys grammar JARs from dist/', () => {
    writeFileSync(join(projectDir, 'dist', 'my-grammar.jar'), 'jar-content')
    deployGrammarJars(serverDir, projectDir, 'paper')
    expect(existsSync(join(serverDir, 'plugins', 'Ink', 'plugins', 'my-grammar.jar'))).toBe(true)
  })

  it('handles missing server dir gracefully for deployScripts', () => {
    const badServerDir = join(tmpDir, 'nonexistent')
    mkdirSync(join(projectDir, 'dist', 'scripts'), { recursive: true })
    writeFileSync(join(projectDir, 'dist', 'scripts', 'main.inkc'), 'bytecode')
    expect(() => deployScripts(badServerDir, projectDir)).not.toThrow()
    expect(existsSync(join(badServerDir, 'plugins', 'Ink', 'scripts', 'main.inkc'))).toBe(true)
  })
})
