import { defineGrammar, declaration, rule } from '../../src/grammar/api.js'
import { serialize } from '../../src/grammar/serializer.js'
import { test, expect } from 'vitest'

test('serialize produces valid GrammarPackage', () => {
  const authored = defineGrammar({
    package: 'ink.mobs',
    declarations: [
      declaration({
        keyword: 'mob',
        name: 'identifier',
        inheritsBase: true,
        rules: [
          rule('phase_clause', r => r.seq(
            r.keyword('on'),
            r.keyword('phase'),
            r.int(),
            r.block()
          ))
        ]
      })
    ]
  })

  const ir = serialize(authored)

  expect(ir.version).toBe(1)
  expect(ir.package).toBe('ink.mobs')
  expect(ir.keywords).toContain('mob')
  expect(ir.keywords).toContain('on')
  expect(ir.keywords).toContain('phase')
  expect(Object.keys(ir.rules)).toContain('ink.mobs/phase_clause')
  expect(ir.declarations.length).toBe(1)
  expect(ir.declarations[0].keyword).toBe('mob')
  expect(ir.declarations[0].inheritsBase).toBe(true)
  expect(ir.declarations[0].scopeRules).toContain('ink.mobs/phase_clause')
})

test('keywords are deduplicated', () => {
  const authored = defineGrammar({
    package: 'ink.test',
    declarations: [
      declaration({
        keyword: 'foo',
        name: 'identifier',
        inheritsBase: false,
        rules: [
          rule('test', r => r.seq(
            r.keyword('same'),
            r.keyword('same')
          ))
        ]
      })
    ]
  })
  const ir = serialize(authored)
  const sameCount = ir.keywords.filter(k => k === 'same').length
  expect(sameCount).toBe(1)
})

test('ref rules get namespaced', () => {
  const authored = defineGrammar({
    package: 'ink.test',
    declarations: [
      declaration({
        keyword: 'outer',
        name: 'identifier',
        inheritsBase: false,
        rules: [
          rule('inner', r => r.ref('other'))
        ]
      }),
      declaration({
        keyword: 'other',
        name: 'identifier',
        inheritsBase: false,
        rules: [
          rule('x', r => r.identifier())
        ]
      })
    ]
  })
  const ir = serialize(authored)
  expect(ir.rules['ink.test/inner']).toEqual({ type: 'ref', rule: 'ink.test/other' })
})
