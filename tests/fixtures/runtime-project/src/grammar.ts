import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'

export default defineGrammar({
  package: 'ink.mobs',
  declarations: [
    declaration({
      keyword: 'mob',
      inheritsBase: true,
      rules: [
        rule('spawn_clause', r => r.seq(
          r.keyword('spawn'),
          r.identifier()
        ))
      ]
    })
  ]
})
