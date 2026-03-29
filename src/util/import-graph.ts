import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'

/**
 * Discover all .ink files reachable from an entry point via `import "./..."` statements.
 * Uses regex-based scanning (not a full parser) to find import paths before compilation.
 */
export function discoverImportGraph(entryPoint: string): string[] {
  const visited = new Set<string>()
  const files: string[] = []
  const queue = [resolve(entryPoint)]

  while (queue.length > 0) {
    const filePath = queue.shift()!
    const canonical = resolve(filePath)

    if (visited.has(canonical)) continue
    visited.add(canonical)

    if (!existsSync(canonical)) continue

    const source = readFileSync(canonical, 'utf-8')
    files.push(canonical)

    // Match file import paths: import "./path" and import x, y from "./path"
    const importRegex = /import\s+(?:\w+(?:\s*,\s*\w+)*\s+from\s+)?["'](\.\.?\/[^"']+)["']/g
    let match
    while ((match = importRegex.exec(source)) !== null) {
      const importPath = match[1]
      const targetBase = importPath.endsWith('.ink') ? importPath : importPath + '.ink'
      const resolved = resolve(dirname(canonical), targetBase)
      if (!visited.has(resolved)) {
        queue.push(resolved)
      }
    }
  }

  return files
}
