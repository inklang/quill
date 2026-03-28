import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'

export default defineGrammar({
  package: 'ink.paper',
  declarations: [
    declaration({
      keyword: 'mob',
      inheritsBase: true,
      rules: [
        rule('on_spawn_clause',    r => r.seq(r.keyword('on_spawn'),    r.block())),
        rule('on_death_clause',    r => r.seq(r.keyword('on_death'),    r.block())),
        rule('on_damage_clause',   r => r.seq(r.keyword('on_damage'),   r.block())),
        rule('on_tick_clause',     r => r.seq(r.keyword('on_tick'),     r.block())),
        rule('on_target_clause',   r => r.seq(r.keyword('on_target'),   r.block())),
        rule('on_interact_clause', r => r.seq(r.keyword('on_interact'), r.block())),
      ]
    }),
    declaration({
      keyword: 'player',
      inheritsBase: true,
      rules: [
        rule('on_join_clause',  r => r.seq(r.keyword('on_join'),  r.block())),
        rule('on_leave_clause', r => r.seq(r.keyword('on_leave'), r.block())),
        rule('on_chat_clause',  r => r.seq(r.keyword('on_chat'),  r.block())),
      ]
    }),
    declaration({
      keyword: 'command',
      inheritsBase: true,
      rules: [
        rule('command_clause', r => r.block()),
      ]
    }),
  ]
})
