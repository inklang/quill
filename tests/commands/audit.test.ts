import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AuditCommand } from '../../src/commands/audit.js'
import { RegistryPackage, RegistryPackageVersion } from '../../src/registry/client.js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('AuditCommand', () => {
  let mockScanner: any
  const TMP = path.join(__dirname, '../fixtures/.tmp-audit-test')

  beforeEach(() => {
    mockScanner = {
      scan: vi.fn().mockResolvedValue([]),
    }
  })

  afterEach(() => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })

  function createMockClient(pkgName: string, version: string, dependencies: Record<string, string> = {}, checksum?: string) {
    const pkgVersion = new RegistryPackageVersion(version, 'http://example.com.tar.gz', dependencies, undefined, undefined, undefined, checksum)
    const pkg = new RegistryPackage(pkgName, new Map([[version, pkgVersion]]))
    const index = new Map([[pkgName, pkg]])

    const client = {
      fetchIndex: vi.fn().mockResolvedValue(index),
      findBestMatch: vi.fn().mockReturnValue(pkgVersion),
    } as any
    return client
  }

  it('exits 0 when no vulnerabilities found', async () => {
    const client = createMockClient('lodash', '4.17.20')
    const cmd = new AuditCommand(client, mockScanner, mockScanner, mockScanner)
    const exitCode = await cmd.run({ pkg: 'lodash@4.17.20', json: false, offline: false })
    expect(exitCode).toBe(0)
  })

  it('exits 1 when vulnerabilities found', async () => {
    mockScanner.scan.mockResolvedValue([{
      id: 'CVE-2024-1234',
      summary: 'Buffer overflow in parser',
      severity: 'HIGH',
    }])
    const client = createMockClient('evil-pkg', '1.0.0', { 'some-dep': '1.0.0' })
    const cmd = new AuditCommand(client, mockScanner, mockScanner, mockScanner)
    const exitCode = await cmd.run({ pkg: 'evil-pkg@1.0.0', json: false, offline: false })
    expect(exitCode).toBe(1)
  })

  it('exits 2 on checksum mismatch', async () => {
    // Create a mock package directory with a tarball so checksum verification runs
    const pkgDir = path.join(TMP, 'packages', 'pkg')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'pkg-1.0.0.tar.gz'), 'fake tarball content')

    const checksumVerifier = {
      verify: vi.fn().mockResolvedValue({ valid: false, computed: 'sha256:abc', expected: 'sha256:def' }),
    }
    const client = createMockClient('pkg', '1.0.0', {}, 'sha256:def')
    const cmd = new AuditCommand(client, mockScanner, mockScanner, checksumVerifier as any, path.join(TMP, 'packages'))
    const exitCode = await cmd.run({ pkg: 'pkg@1.0.0', json: false, offline: false })
    expect(exitCode).toBe(2)
  })
})