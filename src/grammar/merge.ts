import type { GrammarPackage } from './ir.js'

export function mergeGrammars(
  base: GrammarPackage,
  packages: GrammarPackage[]
): GrammarPackage {
  if (packages.length === 0) return base

  const mergedDeclarations = [...base.declarations]
  const mergedRules: Record<string, typeof base.rules[string]> = { ...base.rules }
  const mergedKeywords: string[] = [...base.keywords]

  const declarationOwners = new Map<string, string>()
  const ruleOwners = new Map<string, string>()

  for (const decl of base.declarations) {
    declarationOwners.set(decl.keyword, base.package)
  }
  for (const ruleName of Object.keys(base.rules)) {
    ruleOwners.set(ruleName, base.package)
  }

  for (const pkg of packages) {
    for (const decl of pkg.declarations) {
      const existing = declarationOwners.get(decl.keyword)
      if (existing) {
        throw new Error(
          `Package ${existing} and ${pkg.package} both provide declaration '${decl.keyword}'`
        )
      }
      declarationOwners.set(decl.keyword, pkg.package)
      mergedDeclarations.push(decl)
    }

    for (const [ruleName, ruleEntry] of Object.entries(pkg.rules)) {
      const existing = ruleOwners.get(ruleName)
      if (existing) {
        throw new Error(
          `Package ${existing} and ${pkg.package} both define rule '${ruleName}'`
        )
      }
      ruleOwners.set(ruleName, pkg.package)
      mergedRules[ruleName] = ruleEntry
    }

    mergedKeywords.push(...pkg.keywords)
  }

  return {
    version: base.version,
    package: base.package,
    keywords: mergedKeywords,
    rules: mergedRules,
    declarations: mergedDeclarations,
  }
}
