import { RegistryPackageVersion } from './registry/client.js'
import { Semver } from './model/semver.js'
import { SemverRange } from './model/semver.js'

export interface ResolvedPkg {
  name: string
  version: string
  url: string
  range: string
  targets?: string[]
  checksum?: string
  depKeys: string[]  // "name@resolvedVersion" of direct deps — for lock file graph
}

export function resolveTransitive(
  index: object,
  roots: Record<string, string>,
): Map<string, ResolvedPkg> {
  const resolved = new Map<string, ResolvedPkg>()
  const ranges = new Map<string, string[]>()
  const visiting = new Set<string>()

  function resolve(name: string, range: string, requiredBy: string): void {
    const existing = ranges.get(name) ?? []
    if (existing.includes(range)) return
    ranges.set(name, [...existing, range])

    const allRanges = ranges.get(name)!
    const version = findBestMatchAllRanges(index, name, allRanges)

    if (!version) {
      throw new Error(
        `No version of ${name} satisfies all requirements: ${allRanges.join(', ')} (required by ${requiredBy})`
      )
    }

    const existingResolved = resolved.get(name)
    if (existingResolved && existingResolved.version === version.version) return

    const entry: ResolvedPkg = {
      name,
      version: version.version,
      url: version.url,
      range: allRanges.join(' && '),
      targets: version.targets,
      checksum: version.checksum,
      depKeys: [],
    }
    resolved.set(name, entry)

    if (visiting.has(name)) return
    visiting.add(name)

    const deps = version.dependencies ?? {}
    for (const [depName, depRange] of Object.entries(deps)) {
      resolve(depName, depRange, name)
      const resolvedDep = resolved.get(depName)
      if (resolvedDep) {
        entry.depKeys.push(`${depName}@${resolvedDep.version}`)
      }
    }

    visiting.delete(name)
  }

  for (const [name, range] of Object.entries(roots)) {
    resolve(name, range, '<root>')
  }

  return resolved
}

function findBestMatchAllRanges(
  index: object,
  pkgName: string,
  ranges: string[],
): RegistryPackageVersion | null {
  let pkg: any
  if (index instanceof Map) {
    pkg = index.get(pkgName)
  } else {
    const getFn = (index as any).get || (index as any).getRegistryPackage
    if (getFn) pkg = getFn(pkgName)
  }
  if (!pkg) return null

  const semverRanges = ranges.map(r => new SemverRange(r))

  let best: { ver: RegistryPackageVersion; parsed: Semver } | null = null
  for (const [verStr, ver] of pkg.versions.entries()) {
    try {
      const parsed = Semver.parse(verStr)
      const matches = semverRanges.every(r => r.matches(parsed))
      if (matches) {
        if (!best || parsed.compareTo(best.parsed) > 0) {
          best = { ver, parsed }
        }
      }
    } catch {}
  }

  return best?.ver ?? null
}
