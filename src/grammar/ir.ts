// src/grammar/ir.ts

export interface GrammarPackage {
  version: 1
  package: string
  keywords: string[]
  rules: Record<string, Rule>
  declarations: DeclarationDef[]
}

export interface DeclarationDef {
  keyword: string
  nameRule: Rule
  scopeRules: string[]
  inheritsBase: boolean
}

export type Rule =
  | { type: 'seq'; items: Rule[] }
  | { type: 'choice'; items: Rule[] }
  | { type: 'many'; item: Rule }
  | { type: 'many1'; item: Rule }
  | { type: 'optional'; item: Rule }
  | { type: 'ref'; rule: string }
  | { type: 'keyword'; value: string }
  | { type: 'literal'; value: string }
  | { type: 'identifier' }
  | { type: 'int' }
  | { type: 'float' }
  | { type: 'string' }
  | { type: 'block'; scope: string | null }
