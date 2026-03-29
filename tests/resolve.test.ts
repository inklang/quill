import { describe, it, expect } from 'vitest'
import { resolveTransitive } from '../src/resolve.js'
import { RegistryClient } from '../src/registry/client.js'

function buildIndex(packages: { name: string; version: string; deps?: Record<string, string> }[]): object {
  const client = new RegistryClient('http://localhost:0')
  const indexData: any = { packages: {} }
  for (const pkg of packages) {
    if (!indexData.packages[pkg.name]) indexData.packages[pkg.name] = {}
    indexData.packages[pkg.name][pkg.version] = {
      url: `http://localhost/tarballs/${pkg.name}-${pkg.version}.tar.gz`,
      dependencies: pkg.deps ?? {},
      description: `desc-${pkg.name}`,
      checksum: `sha256:${pkg.name}-${pkg.version}`,
    }
  }
  return client.parseIndex(JSON.stringify(indexData))
}

describe('resolveTransitive', () => {
  it('resolves a single package with no dependencies', () => {
    const index = buildIndex([
      { name: 'ink.utils', version: '1.0.0' }
    ])
    const result = resolveTransitive(index, { 'ink.utils': '^1.0.0' })
    expect(result.size).toBe(1)
    expect(result.get('ink.utils')!.version).toBe('1.0.0')
  })

  it('resolves transitive dependencies', () => {
    const index = buildIndex([
      { name: 'ink.mobs', version: '1.0.0', deps: { 'ink.utils': '^1.0.0' } },
      { name: 'ink.utils', version: '1.0.0' },
      { name: 'ink.utils', version: '1.5.0' },
    ])
    const result = resolveTransitive(index, { 'ink.mobs': '^1.0.0' })
    expect(result.size).toBe(2)
    expect(result.get('ink.mobs')!.version).toBe('1.0.0')
    expect(result.get('ink.utils')!.version).toBe('1.5.0')
  })

  it('resolves diamond dependencies to highest compatible version', () => {
    const index = buildIndex([
      { name: 'ink.mobs', version: '1.0.0', deps: { 'ink.utils': '^1.0.0' } },
      { name: 'ink.items', version: '1.0.0', deps: { 'ink.utils': '^1.2.0' } },
      { name: 'ink.utils', version: '1.0.0' },
      { name: 'ink.utils', version: '1.2.0' },
      { name: 'ink.utils', version: '1.5.0' },
    ])
    const result = resolveTransitive(index, { 'ink.mobs': '^1.0.0', 'ink.items': '^1.0.0' })
    expect(result.size).toBe(3)
    expect(result.get('ink.utils')!.version).toBe('1.5.0')
  })

  it('errors on incompatible version ranges', () => {
    const index = buildIndex([
      { name: 'ink.mobs', version: '1.0.0', deps: { 'ink.utils': '^1.0.0' } },
      { name: 'ink.items', version: '1.0.0', deps: { 'ink.utils': '^2.0.0' } },
      { name: 'ink.utils', version: '1.5.0' },
      { name: 'ink.utils', version: '2.0.0' },
    ])
    expect(() => resolveTransitive(index, { 'ink.mobs': '^1.0.0', 'ink.items': '^1.0.0' }))
      .toThrow(/ink\.utils/)
  })

  it('handles three levels of transitive deps', () => {
    const index = buildIndex([
      { name: 'a', version: '1.0.0', deps: { 'b': '^1.0.0' } },
      { name: 'b', version: '1.0.0', deps: { 'c': '^1.0.0' } },
      { name: 'c', version: '1.0.0' },
    ])
    const result = resolveTransitive(index, { 'a': '^1.0.0' })
    expect(result.size).toBe(3)
    expect(result.get('a')!.version).toBe('1.0.0')
    expect(result.get('b')!.version).toBe('1.0.0')
    expect(result.get('c')!.version).toBe('1.0.0')
  })

  it('handles circular dependencies without infinite loop', () => {
    const index = buildIndex([
      { name: 'a', version: '1.0.0', deps: { 'b': '^1.0.0' } },
      { name: 'b', version: '1.0.0', deps: { 'a': '^1.0.0' } },
    ])
    const result = resolveTransitive(index, { 'a': '^1.0.0' })
    expect(result.size).toBe(2)
  })

  it('errors when a dependency is not found in the registry', () => {
    const index = buildIndex([
      { name: 'ink.mobs', version: '1.0.0', deps: { 'ink.missing': '^1.0.0' } },
    ])
    expect(() => resolveTransitive(index, { 'ink.mobs': '^1.0.0' }))
      .toThrow(/ink\.missing/)
  })

  it('handles package with no dependencies', () => {
    const index = buildIndex([
      { name: 'ink.standalone', version: '1.0.0' }
    ])
    const result = resolveTransitive(index, { 'ink.standalone': '^1.0.0' })
    expect(result.size).toBe(1)
    expect(result.get('ink.standalone')!.depKeys).toEqual([])
  })

  it('records resolved dependency edges (name@resolvedVersion)', () => {
    const index = buildIndex([
      { name: 'ink.mobs', version: '1.0.0', deps: { 'ink.utils': '^1.0.0' } },
      { name: 'ink.utils', version: '1.0.0' },
      { name: 'ink.utils', version: '1.5.0' },
    ])
    const result = resolveTransitive(index, { 'ink.mobs': '^1.0.0' })
    expect(result.get('ink.mobs')!.depKeys).toEqual(['ink.utils@1.5.0'])
    expect(result.get('ink.utils')!.depKeys).toEqual([])
  })
})
