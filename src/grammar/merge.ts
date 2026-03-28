import type { GrammarPackage, DeclarationDef } from './ir.js'

export function mergeGrammars(
  base: GrammarPackage,
  packages: GrammarPackage[],
  aliases?: Map<string, string>
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
    const alias = aliases?.get(pkg.package)
    // Track original keywords from this package that were renamed due to conflicts
    const renamedOriginals = new Set<string>()

    for (const decl of pkg.declarations) {
      const existing = declarationOwners.get(decl.keyword)
      if (existing) {
        // Conflict: base/first package always wins (stays unrenamed)
        // If the conflicting package has an alias, rename its keyword
        if (alias) {
          const renamedKeyword = `${alias}_${decl.keyword}`
          const renamedDecl: DeclarationDef = {
            ...decl,
            keyword: renamedKeyword,
            scopeRules: [...decl.scopeRules],
          }
          declarationOwners.set(renamedKeyword, pkg.package)
          mergedDeclarations.push(renamedDecl)
          mergedKeywords.push(renamedKeyword)
          renamedOriginals.add(decl.keyword)
        } else {
          throw new Error(
            `Package ${existing} and ${pkg.package} both provide declaration '${decl.keyword}'. ` +
            `Use 'using ${pkg.package} as <alias>' to resolve the conflict.`
          )
        }
      } else {
        declarationOwners.set(decl.keyword, pkg.package)
        mergedDeclarations.push(decl)
      }
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

    // Add keywords, skipping originals that were renamed
    for (const kw of pkg.keywords) {
      if (renamedOriginals.has(kw)) continue
      if (!mergedKeywords.includes(kw)) {
        mergedKeywords.push(kw)
      }
    }
  }

  return {
    version: base.version,
    package: base.package,
    keywords: mergedKeywords,
    rules: mergedRules,
    declarations: mergedDeclarations,
  }
}
