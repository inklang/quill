// src/grammar/serializer.ts
import { AuthoredGrammar, RuleBuilder } from './api.js'
import { GrammarPackage, RuleEntry, Rule } from './ir.js'

function namespaced(packageName: string, ruleName: string): string {
  return `${packageName}/${ruleName}`
}

function serializeRule(r: Rule, pkg: string): Rule {
  switch (r.type) {
    case 'seq':
      return { type: 'seq', items: r.items.map(item => serializeRule(item, pkg)) }
    case 'choice':
      return { type: 'choice', items: r.items.map(item => serializeRule(item, pkg)) }
    case 'many':
      return { type: 'many', item: serializeRule(r.item, pkg) }
    case 'many1':
      return { type: 'many1', item: serializeRule(r.item, pkg) }
    case 'optional':
      return { type: 'optional', item: serializeRule(r.item, pkg) }
    case 'ref':
      return { type: 'ref', rule: namespaced(pkg, r.rule) }
    case 'keyword':
      return r
    case 'block':
      return { type: 'block', scope: r.scope }
    default:
      return r
  }
}

function collectKeywords(r: Rule): string[] {
  switch (r.type) {
    case 'keyword':
      return [r.value]
    case 'seq':
    case 'choice':
      return r.items.flatMap(collectKeywords)
    case 'many':
    case 'many1':
    case 'optional':
      return collectKeywords(r.item)
    default:
      return []
  }
}

export function serialize(grammar: AuthoredGrammar): GrammarPackage {
  const rules: Record<string, RuleEntry> = {}
  const keywords: string[] = []

  for (const decl of grammar.declarations) {
    for (const [ruleName, rule, handler] of decl.rules) {
      const nsName = namespaced(grammar.package, ruleName)
      const entry: RuleEntry = { rule: serializeRule(rule, grammar.package) }
      if (handler) entry.handler = handler
      rules[nsName] = entry
      keywords.push(...collectKeywords(rule))
      keywords.push(decl.keyword)
    }
  }

  const declarations = grammar.declarations.map(decl => {
    const nameRule: Rule = typeof decl.name === 'function' ? decl.name(new RuleBuilder()) : { type: 'identifier' }
    const scopeRuleNames = decl.rules.map(([name]) => namespaced(grammar.package, name))
    const def: { keyword: string; nameRule: Rule; scopeRules: string[]; inheritsBase: boolean; handler?: string } = {
      keyword: decl.keyword,
      nameRule,
      scopeRules: scopeRuleNames,
      inheritsBase: decl.inheritsBase,
    }
    if (decl.handler) def.handler = decl.handler
    return def
  })

  const uniqueKeywords = [...new Set(keywords)]

  return {
    version: 1,
    package: grammar.package,
    keywords: uniqueKeywords,
    rules,
    declarations,
  }
}
