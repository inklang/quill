import { defineGrammar, declaration, rule, RuleBuilder } from '../../src/grammar/api'
import { test, expect } from 'vitest'

test('defineGrammar accepts package and declarations', () => {
  const g = defineGrammar({
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
  expect(g.package).toBe('ink.mobs')
  expect(g.declarations.length).toBe(1)
  expect(g.declarations[0].keyword).toBe('mob')
})

test('RuleBuilder produces all rule types', () => {
  const builder = new RuleBuilder()
  expect(builder.seq(builder.identifier(), builder.int())).toEqual({
    type: 'seq',
    items: [{ type: 'identifier' }, { type: 'int' }]
  })
  expect(builder.choice(builder.keyword('a'), builder.keyword('b'))).toEqual({
    type: 'choice',
    items: [{ type: 'keyword', value: 'a' }, { type: 'keyword', value: 'b' }]
  })
  expect(builder.many(builder.identifier())).toEqual({ type: 'many', item: { type: 'identifier' } })
  expect(builder.many1(builder.identifier())).toEqual({ type: 'many1', item: { type: 'identifier' } })
  expect(builder.optional(builder.identifier())).toEqual({ type: 'optional', item: { type: 'identifier' } })
  expect(builder.ref('my_rule')).toEqual({ type: 'ref', rule: 'my_rule' })
  expect(builder.keyword('test')).toEqual({ type: 'keyword', value: 'test' })
  expect(builder.literal('"hello"')).toEqual({ type: 'literal', value: '"hello"' })
  expect(builder.identifier()).toEqual({ type: 'identifier' })
  expect(builder.int()).toEqual({ type: 'int' })
  expect(builder.float()).toEqual({ type: 'float' })
  expect(builder.string()).toEqual({ type: 'string' })
  expect(builder.block()).toEqual({ type: 'block', scope: null })
  expect(builder.block('inner_scope')).toEqual({ type: 'block', scope: 'inner_scope' })
})
