import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'

export default defineGrammar({
  package: 'ink.gradletest',
  declarations: [
    declaration({
      keyword: 'testblock',
      inheritsBase: true,
      rules: [
        rule('test_rule', r => r.identifier())
      ]
    })
  ]
})
