import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PackCommand } from '../../src/commands/pack.js'

describe('PackCommand', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'quill-pack-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function createValidProject(): void {
    writeFileSync(join(tempDir, 'ink.pkg'), JSON.stringify({
      name: 'ink.test',
      version: '1.0.0',
      grammar: 'grammar.json',
      provides: ['test'],
      depends: [],
    }))

    writeFileSync(join(tempDir, 'grammar.json'), JSON.stringify({
      version: 1,
      package: 'ink.test',
      keywords: ['test'],
      rules: {},
      declarations: [{
        keyword: 'test',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    }))
  }

  it('validates that provides matches grammar keywords', () => {
    createValidProject()
    const cmd = new PackCommand(tempDir)
    expect(() => cmd.validate()).not.toThrow()
  })

  it('rejects mismatched provides vs keywords', () => {
    createValidProject()
    writeFileSync(join(tempDir, 'ink.pkg'), JSON.stringify({
      name: 'ink.test',
      version: '1.0.0',
      grammar: 'grammar.json',
      provides: ['wrong'],
      depends: [],
    }))
    const cmd = new PackCommand(tempDir)
    expect(() => cmd.validate()).toThrow(/provides.*keywords/)
  })

  it('rejects missing ink.pkg', () => {
    const cmd = new PackCommand(tempDir)
    expect(() => cmd.validate()).toThrow(/ink\.pkg/)
  })

  it('rejects missing grammar.json', () => {
    writeFileSync(join(tempDir, 'ink.pkg'), JSON.stringify({
      name: 'ink.test',
      version: '1.0.0',
      grammar: 'grammar.json',
      provides: ['test'],
      depends: [],
    }))
    const cmd = new PackCommand(tempDir)
    expect(() => cmd.validate()).toThrow(/grammar\.json/)
  })

  it('validates runtime JAR exists when runtime specified', () => {
    createValidProject()
    writeFileSync(join(tempDir, 'ink.pkg'), JSON.stringify({
      name: 'ink.test',
      version: '1.0.0',
      grammar: 'grammar.json',
      runtime: { jar: 'lib/test.jar', entry: 'org.example.Bridge' },
      provides: ['test'],
      depends: [],
    }))
    const cmd = new PackCommand(tempDir)
    expect(() => cmd.validate()).toThrow(/runtime.*JAR/i)
  })

  it('passes when runtime JAR exists', () => {
    createValidProject()
    mkdirSync(join(tempDir, 'lib'), { recursive: true })
    writeFileSync(join(tempDir, 'lib/test.jar'), 'fake jar')
    writeFileSync(join(tempDir, 'ink.pkg'), JSON.stringify({
      name: 'ink.test',
      version: '1.0.0',
      grammar: 'grammar.json',
      runtime: { jar: 'lib/test.jar', entry: 'org.example.Bridge' },
      provides: ['test'],
      depends: [],
    }))
    const cmd = new PackCommand(tempDir)
    expect(() => cmd.validate()).not.toThrow()
  })
})
