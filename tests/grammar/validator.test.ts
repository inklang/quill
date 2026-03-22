import { defineGrammar, declaration, rule } from '../../src/grammar/api.js'
import { validate, checkKeywordConflicts } from '../../src/grammar/validator.js'
import { test, expect } from 'vitest'

test('detect unresolved ref', () => {
  const g = defineGrammar({
    package: 'ink.test',
    declarations: [
      declaration({
        keyword: 'outer',
        inheritsBase: false,
        rules: [
          rule('inner', r => r.ref('nonexistent'))
        ]
      })
    ]
  })
  const errors = validate(g)
  expect(errors.some(e => e.type === 'unresolved_ref')).toBe(true)
})

test('no errors for valid refs', () => {
  const g = defineGrammar({
    package: 'ink.test',
    declarations: [
      declaration({
        keyword: 'outer',
        inheritsBase: false,
        rules: [
          rule('inner', r => r.ref('x'))
        ]
      }),
      declaration({
        keyword: 'other',
        inheritsBase: false,
        rules: [
          rule('x', r => r.identifier())
        ]
      })
    ]
  })
  const errors = validate(g)
  expect(errors.length).toBe(0)
})

test('detect keyword conflict between packages', () => {
  const g1 = defineGrammar({ package: 'pkg.a', declarations: [declaration({ keyword: 'mob', inheritsBase: false, rules: [] })] })
  const g2 = defineGrammar({ package: 'pkg.b', declarations: [declaration({ keyword: 'mob', inheritsBase: false, rules: [] })] })
  const errors = checkKeywordConflicts([g1, g2])
  expect(errors.some(e => e.type === 'keyword_conflict')).toBe(true)
})
