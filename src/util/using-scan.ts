/**
 * Scans a .ink source file for `using <pkg>` declarations.
 * Using declarations must appear at the very top of the file,
 * before any other statements. Blank lines between using declarations
 * are allowed. Scanning stops at the first non-using, non-blank line.
 */
export function scanUsingDeclarations(source: string): string[] {
  const packages: string[] = []
  const lines = source.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    const match = trimmed.match(/^using\s+(\S+)$/)
    if (match) {
      packages.push(match[1])
    } else {
      break
    }
  }

  return packages
}
