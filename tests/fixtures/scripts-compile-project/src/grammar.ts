import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'

export default defineGrammar({
  package: 'ink.compiletest',
  declarations: [
    declaration({
      keyword: 'thing',
      inheritsBase: true,
      rules: [
        rule('thing_rule', r => r.identifier())
      ]
    })
  ]
})
