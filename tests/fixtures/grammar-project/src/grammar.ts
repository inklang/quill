import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'

export default defineGrammar({
  package: 'ink.test',
  declarations: [
    declaration({
      keyword: 'entity',
      name: 'identifier',
      inheritsBase: true,
      rules: [
        rule('spawn_clause', r => r.seq(
          r.keyword('spawn'),
          r.identifier(),
          r.block()
        ))
      ]
    })
  ]
})
