// tests/grammar/using-merge.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanUsingDeclarations } from '../../src/util/using-scan.js'
import { mergeGrammars } from '../../src/grammar/merge.js'
import type { GrammarPackage } from '../../src/grammar/ir.js'

function makeGrammar(overrides: Partial<GrammarPackage>): GrammarPackage {
  return {
    version: 1,
    package: overrides.package ?? 'test',
    keywords: overrides.keywords ?? [],
    rules: overrides.rules ?? {},
    declarations: overrides.declarations ?? [],
  }
}

describe('using + merge end-to-end', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `quill-using-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('scans using declarations and merges grammars', async () => {
    // 1. Create a sample package
    const pkgDir = join(tempDir, 'packages', 'ink.sample')
    mkdirSync(pkgDir, { recursive: true })

    const pkgGrammar: GrammarPackage = {
      version: 1,
      package: 'ink.sample',
      keywords: ['item'],
      rules: {
        'ink.sample/item_rarity': { rule: { type: 'keyword', value: 'rarity' } },
      },
      declarations: [{
        keyword: 'item',
        nameRule: { type: 'identifier' },
        scopeRules: ['ink.sample/item_rarity'],
        inheritsBase: true,
      }],
    }

    writeFileSync(join(pkgDir, 'ink.pkg'), JSON.stringify({
      name: 'ink.sample',
      version: '1.0.0',
      grammar: 'grammar.json',
      provides: ['item'],
      depends: [],
    }))

    writeFileSync(join(pkgDir, 'grammar.json'), JSON.stringify(pkgGrammar))

    // 2. Simulate a source file with `using ink.sample`
    const source = `using ink.sample

item Sword {
  name: "Iron Sword"
}
`
    const packageNames = scanUsingDeclarations(source)
    expect(packageNames).toEqual([{ package: 'ink.sample' }])

    // 3. Load and merge grammars
    const baseGrammar = makeGrammar({
      package: 'my.project',
      keywords: ['print'],
      declarations: [{
        keyword: 'print',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: false,
      }],
    })

    const pkgManifest = JSON.parse(readFileSync(join(pkgDir, 'ink.pkg'), 'utf-8'))
    const grammarPath = join(pkgDir, pkgManifest.grammar)
    const loadedPkgGrammar = JSON.parse(readFileSync(grammarPath, 'utf-8'))

    const merged = mergeGrammars(baseGrammar, [loadedPkgGrammar])

    // 4. Verify merged result
    expect(merged.keywords).toEqual(['print', 'item'])
    expect(merged.declarations).toHaveLength(2)
    expect(merged.declarations[0].keyword).toBe('print')
    expect(merged.declarations[1].keyword).toBe('item')
    expect(Object.keys(merged.rules)).toContain('ink.sample/item_rarity')
  })

  it('resolves conflicting keywords with aliased using', () => {
    // Source with aliased package
    const source = `using ink.mobs
using ink.mythic-mobs as mythic

mob Zombie {}
mythic_mob BossZombie {}
`
    const decls = scanUsingDeclarations(source)
    expect(decls).toEqual([
      { package: 'ink.mobs' },
      { package: 'ink.mythic-mobs', alias: 'mythic' },
    ])

    // Build aliases map as ink-build does
    const aliases = new Map<string, string | undefined>()
    for (const d of decls) {
      if (d.alias !== undefined) {
        aliases.set(d.package, d.alias)
      } else {
        aliases.set(d.package, undefined)
      }
    }

    // Base grammar
    const baseGrammar = makeGrammar({ package: 'my.project' })

    // Both packages declare 'mob'
    const mobsPkg = makeGrammar({
      package: 'ink.mobs',
      keywords: ['mob'],
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })

    const mythicPkg = makeGrammar({
      package: 'ink.mythic-mobs',
      keywords: ['mob'],
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })

    const merged = mergeGrammars(baseGrammar, [mobsPkg, mythicPkg], aliases)

    // Both keywords present: original 'mob' and renamed 'mythic_mob'
    expect(merged.keywords).toEqual(['mob', 'mythic_mob'])
    expect(merged.declarations).toHaveLength(2)
    expect(merged.declarations[0].keyword).toBe('mob')
    expect(merged.declarations[1].keyword).toBe('mythic_mob')
  })
})
