export interface UsingDecl {
  package: string
  alias?: string
}

/**
 * Scans a .ink source file for `using <pkg>` and `using <pkg> as <alias>` declarations.
 * Using declarations must appear at the very top of the file,
 * before any other statements. Blank lines between using declarations
 * are allowed. Scanning stops at the first non-using, non-blank line.
 */
export function scanUsingDeclarations(source: string): UsingDecl[] {
  const packages: UsingDecl[] = []
  const lines = source.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    const match = trimmed.match(/^using\s+(\S+)(?:\s+as\s+(\S+))?\s*$/)
    if (match) {
      packages.push({ package: match[1], alias: match[2] || undefined })
    } else {
      break
    }
  }

  return packages
}
