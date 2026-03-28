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

  it('throws on duplicate declaration keywords without alias', () => {
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
      /ink\.foo.*ink\.bar.*mob.*using.*as/
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

  it('renames conflicting keyword when package has alias', () => {
    const base = makeGrammar({ package: 'base' })
    const pkg1 = makeGrammar({
      package: 'ink.mobs',
      keywords: ['mob'],
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })
    const pkg2 = makeGrammar({
      package: 'ink.mythic',
      keywords: ['mob'],
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })
    const aliases = new Map<string, string>([['ink.mythic', 'mythic']])
    const result = mergeGrammars(base, [pkg1, pkg2], aliases)

    // First package keeps 'mob', second gets renamed to 'mythic_mob'
    expect(result.declarations).toHaveLength(2)
    expect(result.declarations[0].keyword).toBe('mob')
    expect(result.declarations[1].keyword).toBe('mythic_mob')
  })

  it('base grammar wins over aliased package', () => {
    const base = makeGrammar({
      package: 'my.project',
      keywords: ['mob'],
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })
    const pkg = makeGrammar({
      package: 'ink.other',
      keywords: ['mob'],
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })
    const aliases = new Map<string, string>([['ink.other', 'alt']])
    const result = mergeGrammars(base, [pkg], aliases)

    expect(result.declarations).toHaveLength(2)
    expect(result.declarations[0].keyword).toBe('mob')
    expect(result.declarations[1].keyword).toBe('alt_mob')
  })

  it('renames multiple conflicting declarations from same aliased package', () => {
    const base = makeGrammar({ package: 'base' })
    const pkg1 = makeGrammar({
      package: 'ink.mobs',
      keywords: ['mob', 'entity'],
      declarations: [
        { keyword: 'mob', nameRule: { type: 'identifier' }, scopeRules: [], inheritsBase: true },
        { keyword: 'entity', nameRule: { type: 'identifier' }, scopeRules: [], inheritsBase: true },
      ],
    })
    const pkg2 = makeGrammar({
      package: 'ink.extra',
      keywords: ['mob', 'entity'],
      declarations: [
        { keyword: 'mob', nameRule: { type: 'identifier' }, scopeRules: [], inheritsBase: true },
        { keyword: 'entity', nameRule: { type: 'identifier' }, scopeRules: [], inheritsBase: true },
      ],
    })
    const aliases = new Map<string, string>([['ink.extra', 'ex']])
    const result = mergeGrammars(base, [pkg1, pkg2], aliases)

    expect(result.declarations).toHaveLength(4)
    expect(result.declarations.map(d => d.keyword)).toEqual(['mob', 'entity', 'ex_mob', 'ex_entity'])
  })

  it('does not rename when aliased but no conflict', () => {
    const base = makeGrammar({ package: 'base' })
    const pkg = makeGrammar({
      package: 'ink.items',
      keywords: ['item'],
      declarations: [{
        keyword: 'item',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })
    const aliases = new Map<string, string>([['ink.items', 'items']])
    const result = mergeGrammars(base, [pkg], aliases)

    expect(result.declarations).toHaveLength(1)
    expect(result.declarations[0].keyword).toBe('item')
  })

  it('keywords array reflects renames for conflicting aliased packages', () => {
    const base = makeGrammar({ package: 'base' })
    const pkg1 = makeGrammar({
      package: 'ink.mobs',
      keywords: ['mob'],
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })
    const pkg2 = makeGrammar({
      package: 'ink.mythic',
      keywords: ['mob'],
      declarations: [{
        keyword: 'mob',
        nameRule: { type: 'identifier' },
        scopeRules: [],
        inheritsBase: true,
      }],
    })
    const aliases = new Map<string, string>([['ink.mythic', 'mythic']])
    const result = mergeGrammars(base, [pkg1, pkg2], aliases)

    expect(result.keywords).toEqual(['mob', 'mythic_mob'])
  })
})
