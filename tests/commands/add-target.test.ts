import { describe, it, expect } from 'vitest'
import { RegistryPackageVersion } from '../../src/registry/client'

describe('target validation logic', () => {
  // Test the validation logic in isolation — constructs a RegistryPackageVersion
  // (which now has targets field from Task 3) and verifies target mismatch is detected

  it('detects when package does not support project target', () => {
    const projectTarget = 'paper'
    const pkgVersion = new RegistryPackageVersion(
      '1.0.0',
      'https://example.com/pkg.tar.gz',
      {},
      undefined,  // description
      undefined,  // homepage
      ['wasm', 'node']  // targets — no "paper"
    )

    // Validation: projectTarget && pkgVersion.targets && !pkgVersion.targets.includes(projectTarget)
    const hasValidTarget = projectTarget && pkgVersion.targets && pkgVersion.targets.includes(projectTarget)
    expect(hasValidTarget).toBe(false)
  })

  it('passes when package supports project target', () => {
    const projectTarget = 'paper'
    const pkgVersion = new RegistryPackageVersion(
      '1.0.0',
      'https://example.com/pkg.tar.gz',
      {},
      undefined,
      undefined,
      ['paper', 'wasm']
    )

    const hasValidTarget = projectTarget && pkgVersion.targets && pkgVersion.targets.includes(projectTarget)
    expect(hasValidTarget).toBe(true)
  })

  it('passes when package has no targets field (backward compat for existing packages)', () => {
    const projectTarget = 'paper'
    const pkgVersion = new RegistryPackageVersion(
      '1.0.0',
      'https://example.com/pkg.tar.gz',
      {}
    )

    // Without targets field, validation is skipped (existing packages pre-date this feature)
    expect(pkgVersion.targets).toBeUndefined()
    // Validation should be skipped (no error thrown)
    const hasValidTarget = projectTarget && pkgVersion.targets && pkgVersion.targets.includes(projectTarget)
    expect(hasValidTarget).toBeFalsy()  // Falsy means validation is skipped
  })
})