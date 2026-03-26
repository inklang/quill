import { describe, it, expect, beforeEach, vi } from 'vitest'
import { VulnerabilitiesScanner, Vulnerability } from '../../src/audit/vulnerabilities.js'

describe('VulnerabilitiesScanner', () => {
  let scanner: VulnerabilitiesScanner

  beforeEach(() => {
    scanner = new VulnerabilitiesScanner()
  })

  it('returns empty array when package has no vulnerabilities', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ vulns: [] }),
    } as any)
    const vulns = await scanner.scan('some-package-with-no-vulns', '1.0.0')
    expect(vulns).toEqual([])
    spy.mockRestore()
  })

  it('returns vulnerabilities when found', async () => {
    const vulns = await scanner.scan('minimatch', '3.0.4')
    expect(vulns.length).toBeGreaterThan(0)
    expect(vulns[0]).toHaveProperty('id')
    expect(vulns[0]).toHaveProperty('summary')
    expect(vulns[0]).toHaveProperty('severity')
  })

  it('returns empty array for unknown package', async () => {
    const vulns = await scanner.scan('this-package-definitely-does-not-exist-xyz', '1.0.0')
    expect(vulns).toEqual([])
  })

  it('handles network errors gracefully', async () => {
    const originalFetch = global.fetch
    global.fetch = async () => { throw new Error('network error') }
    const vulns = await scanner.scan('lodash', '4.17.20')
    expect(vulns).toEqual([])
    global.fetch = originalFetch
  })
})