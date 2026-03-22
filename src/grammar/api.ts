// src/grammar/api.ts

import type { Rule } from './ir.js'

export class RuleBuilder {
  seq(...items: Rule[]): Rule { return { type: 'seq', items } }
  choice(...items: Rule[]): Rule { return { type: 'choice', items } }
  many(item: Rule): Rule { return { type: 'many', item } }
  many1(item: Rule): Rule { return { type: 'many1', item } }
  optional(item: Rule): Rule { return { type: 'optional', item } }
  ref(rule: string): Rule { return { type: 'ref', rule } }
  keyword(value: string): Rule { return { type: 'keyword', value } }
  literal(value: string): Rule { return { type: 'literal', value } }
  identifier(): Rule { return { type: 'identifier' } }
  int(): Rule { return { type: 'int' } }
  float(): Rule { return { type: 'float' } }
  string(): Rule { return { type: 'string' } }
  block(scope: string | null = null): Rule { return { type: 'block', scope } }
}

export interface DeclarationInput {
  keyword: string
  name: string
  inheritsBase: boolean
  rules: Array<[string, Rule]>  // [ruleName, rule]
}

export function declaration(input: DeclarationInput): DeclarationInput {
  return input
}

export function rule(name: string, build: (r: RuleBuilder) => Rule): [string, Rule] {
  return [name, build(new RuleBuilder())]
}

export interface GrammarInput {
  package: string
  declarations: DeclarationInput[]
}

export interface AuthoredGrammar {
  package: string
  declarations: DeclarationInput[]
}

export function defineGrammar(input: GrammarInput): AuthoredGrammar {
  return input
}
