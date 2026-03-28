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
        rule('on_execute_clause', r => r.seq(r.keyword('on_execute'), r.block()), 'on_execute'),
        rule('command_clause', r => r.block(), 'on_execute'),  // backwards compat
        rule('permission_clause', r => r.seq(r.keyword('permission'), r.string()), 'permission'),
        rule('alias_clause', r => r.seq(r.keyword('alias'), r.string()), 'alias'),
      ]
    }),
    declaration({
      keyword: 'task',
      inheritsBase: true,
      rules: [
        rule('every_clause', r => r.seq(r.keyword('every'), r.int(), r.keyword('ticks'), r.block()), 'every'),
        rule('delay_clause', r => r.seq(r.keyword('delay'), r.int(), r.keyword('ticks'), r.block()), 'delay'),
      ]
    }),
    declaration({
      keyword: 'config',
      inheritsBase: true,
      rules: [
        rule('file_clause', r => r.seq(r.keyword('file'), r.string()), 'file'),
        rule('config_entry_clause', r => r.seq(r.identifier(), r.literal(':'), r.choice(r.string(), r.int(), r.float(), r.keyword('true'), r.keyword('false'))), 'config_entry'),
      ]
    }),
    declaration({
      keyword: 'scoreboard',
      inheritsBase: true,
      rules: [
        rule('objective_clause', r => r.seq(r.keyword('objective'), r.string(), r.block()), 'objective'),
        rule('criteria_clause', r => r.seq(r.keyword('criteria'), r.string()), 'criteria'),
        rule('display_clause', r => r.seq(r.keyword('display'), r.string()), 'display'),
        rule('slot_clause', r => r.seq(r.keyword('slot'), r.choice(r.keyword('sidebar'), r.keyword('player_list'), r.keyword('below_name'))), 'slot'),
      ]
    }),
    declaration({
      keyword: 'team',
      inheritsBase: true,
      rules: [
        rule('prefix_clause', r => r.seq(r.keyword('prefix'), r.string()), 'prefix'),
        rule('suffix_clause', r => r.seq(r.keyword('suffix'), r.string()), 'suffix'),
        rule('friendly_fire_clause', r => r.seq(r.keyword('friendly_fire'), r.choice(r.keyword('true'), r.keyword('false'))), 'friendly_fire'),
        rule('on_join_clause', r => r.seq(r.keyword('on_join'), r.block()), 'on_join'),
        rule('on_leave_clause', r => r.seq(r.keyword('on_leave'), r.block()), 'on_leave'),
      ]
    }),
    declaration({
      keyword: 'region',
      inheritsBase: true,
      rules: [
        rule('world_clause', r => r.seq(r.keyword('world'), r.string()), 'world'),
        rule('min_clause', r => r.seq(r.keyword('min'), r.int(), r.literal(','), r.int(), r.literal(','), r.int()), 'min'),
        rule('max_clause', r => r.seq(r.keyword('max'), r.int(), r.literal(','), r.int(), r.literal(','), r.int()), 'max'),
        rule('on_enter_clause', r => r.seq(r.keyword('on_enter'), r.block()), 'on_enter'),
        rule('on_leave_clause', r => r.seq(r.keyword('on_leave'), r.block()), 'on_leave'),
      ]
    }),
  ]
})
