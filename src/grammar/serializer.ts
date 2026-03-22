// src/grammar/serializer.ts
import { AuthoredGrammar } from './api.js'
import { GrammarPackage, Rule } from './ir.js'

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
  const rules: Record<string, Rule> = {}
  const keywords: string[] = []

  for (const decl of grammar.declarations) {
    for (const [ruleName, rule] of decl.rules) {
      const nsName = namespaced(grammar.package, ruleName)
      rules[nsName] = serializeRule(rule, grammar.package)
      keywords.push(...collectKeywords(rule))
      keywords.push(decl.keyword)
    }
  }

  const declarations = grammar.declarations.map(decl => {
    const nameRule: Rule = { type: 'identifier' }
    const scopeRuleNames = decl.rules.map(([name]) => namespaced(grammar.package, name))
    return {
      keyword: decl.keyword,
      nameRule,
      scopeRules: scopeRuleNames,
      inheritsBase: decl.inheritsBase,
    }
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
