// src/grammar/validator.ts
import { AuthoredGrammar } from './api.js'
import { Rule } from './ir.js'

export interface ValidationError {
  type: 'unresolved_ref' | 'keyword_conflict'
  ruleName: string
  detail: string
}

function collectRefs(r: Rule): string[] {
  switch (r.type) {
    case 'ref':
      return [r.rule]
    case 'seq':
    case 'choice':
      return r.items.flatMap(collectRefs)
    case 'many':
    case 'many1':
    case 'optional':
      return collectRefs(r.item)
    default:
      return []
  }
}

export function validate(grammar: AuthoredGrammar): ValidationError[] {
  const errors: ValidationError[] = []
  const ruleNames = new Set(
    grammar.declarations.flatMap(d => d.rules.map(([name]) => `${grammar.package}/${name}`))
  )

  for (const decl of grammar.declarations) {
    for (const [ruleName, rule] of decl.rules) {
      for (const ref of collectRefs(rule)) {
        const qualifiedRef = `${grammar.package}/${ref}`
        if (!ruleNames.has(qualifiedRef)) {
          errors.push({
            type: 'unresolved_ref',
            ruleName: `${grammar.package}/${ruleName}`,
            detail: `Unresolved ref: '${qualifiedRef}'`,
          })
        }
      }
    }
  }

  return errors
}

function collectKeywordsFromRule(r: Rule): string[] {
  if (r.type === 'keyword') return [r.value]
  if ('item' in r) return collectKeywordsFromRule(r.item as Rule)
  if ('items' in r) return (r as any).items.flatMap(collectKeywordsFromRule)
  return []
}

export function checkKeywordConflicts(grammars: AuthoredGrammar[]): ValidationError[] {
  const errors: ValidationError[] = []
  const keywordToPackage = new Map<string, string>()

  for (const grammar of grammars) {
    const keywords = new Set(
      grammar.declarations.flatMap(d => [
        d.keyword,
        ...d.rules.flatMap(([, r]) => collectKeywordsFromRule(r))
      ])
    )

    for (const keyword of keywords) {
      const existing = keywordToPackage.get(keyword)
      if (existing && existing !== grammar.package) {
        errors.push({
          type: 'keyword_conflict',
          ruleName: grammar.package,
          detail: `Keyword '${keyword}' is already reserved by package '${existing}'`,
        })
      }
      keywordToPackage.set(keyword, grammar.package)
    }
  }

  return errors
}
