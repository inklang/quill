import { describe, it, expect } from 'vitest'
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

describe('mergeGrammars', () => {
  it('returns base grammar unchanged when no packages', () => {
    const base = makeGrammar({ package: 'base', keywords: ['if'] })
    const result = mergeGrammars(base, [])
    expect(result).toEqual(base)
  })

  it('appends declarations from package grammar', () => {
    const base = makeGrammar({ package: 'base' })
    const pkg = makeGrammar({
      package: 'ink.mobs',
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })
    const result = mergeGrammars(base, [pkg])
    expect(result.declarations).toHaveLength(1)
    expect(result.declarations[0].keyword).toBe('mob')
  })

  it('merges rules from packages by key', () => {
    const base = makeGrammar({
      package: 'base',
      rules: { 'base/rule1': { rule: { type: 'keyword', value: 'if' } } },
    })
    const pkg = makeGrammar({
      package: 'ink.mobs',
      rules: { 'mobs/mob_body': { rule: { type: 'block' } } },
    })
    const result = mergeGrammars(base, [pkg])
    expect(Object.keys(result.rules)).toHaveLength(2)
    expect(result.rules['mobs/mob_body']).toBeDefined()
  })

  it('throws on duplicate declaration keywords across packages', () => {
    const base = makeGrammar({ package: 'base' })
    const pkg1 = makeGrammar({
      package: 'ink.foo',
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })
    const pkg2 = makeGrammar({
      package: 'ink.bar',
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })
    expect(() => mergeGrammars(base, [pkg1, pkg2])).toThrow(
      /ink\.foo.*ink\.bar.*mob/
    )
  })

  it('throws on duplicate rule names across packages', () => {
    const base = makeGrammar({ package: 'base' })
    const pkg1 = makeGrammar({
      package: 'ink.foo',
      rules: { 'shared/rule': { rule: { type: 'keyword', value: 'test' } } },
    })
    const pkg2 = makeGrammar({
      package: 'ink.bar',
      rules: { 'shared/rule': { rule: { type: 'keyword', value: 'test' } } },
    })
    expect(() => mergeGrammars(base, [pkg1, pkg2])).toThrow(
      /ink\.foo.*ink\.bar.*shared\/rule/
    )
  })

  it('merges keywords from all packages', () => {
    const base = makeGrammar({ package: 'base', keywords: ['if', 'else'] })
    const pkg = makeGrammar({ package: 'ink.mobs', keywords: ['mob'] })
    const result = mergeGrammars(base, [pkg])
    expect(result.keywords).toEqual(['if', 'else', 'mob'])
  })
})
