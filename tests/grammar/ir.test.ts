import { describe, it, expect } from 'vitest';
import { GrammarPackage, Rule, DeclarationDef } from '../../src/grammar/ir'

describe('GrammarPackage', () => {
  it('type is structurally correct', () => {
    const pkg: GrammarPackage = {
      version: 1,
      package: 'ink.test',
      keywords: ['mob', 'on', 'phase', 'attack'],
      rules: {},
      declarations: []
    }
    expect(pkg.version).toBe(1)
  })
})

describe('Rule', () => {
  it('all variants are assignable', () => {
    const rules: Rule[] = [
      { type: 'seq', items: [] },
      { type: 'choice', items: [] },
      { type: 'many', item: { type: 'identifier' } },
      { type: 'many1', item: { type: 'identifier' } },
      { type: 'optional', item: { type: 'identifier' } },
      { type: 'ref', rule: 'foo' },
      { type: 'keyword', value: 'bar' },
      { type: 'literal', value: 'baz' },
      { type: 'identifier' },
      { type: 'int' },
      { type: 'float' },
      { type: 'string' },
      { type: 'block', scope: null },
    ]
    expect(rules.length).toBe(13)
  })
})
