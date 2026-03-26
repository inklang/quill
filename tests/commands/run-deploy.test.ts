import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { deployGrammarJars } from '../../src/commands/run'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import os from 'os'

describe('deployGrammarJars', () => {
  const tmpDir = join(os.tmpdir(), 'quill-deploy-test')
  const serverDir = join(tmpDir, 'server')
  const projectDir = join(tmpDir, 'project')

  beforeEach(() => {
    mkdirSync(join(serverDir, 'plugins', 'Ink', 'plugins'), { recursive: true })
    mkdirSync(join(projectDir, 'dist'), { recursive: true })
    writeFileSync(join(projectDir, 'dist', 'mobs-runtime.jar'), 'fake-jar')
    writeFileSync(join(projectDir, 'dist', 'grammar.ir.json'), '{}')  // not a JAR
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('copies JARs from dist/ to server plugins dir', () => {
    deployGrammarJars(serverDir, projectDir, 'paper')
    expect(existsSync(join(serverDir, 'plugins', 'Ink', 'plugins', 'mobs-runtime.jar'))).toBe(true)
  })

  it('skips non-JAR files in dist/', () => {
    deployGrammarJars(serverDir, projectDir, 'paper')
    const pluginFiles = readdirSync(join(serverDir, 'plugins', 'Ink', 'plugins'))
    expect(pluginFiles).toEqual(['mobs-runtime.jar'])
  })
})