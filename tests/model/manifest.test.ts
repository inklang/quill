import { describe, it, expect } from 'vitest'
import { PackageManifest } from '../../src/model/manifest'

describe('PackageManifest', () => {
  it('has optional target field', () => {
    const manifest: PackageManifest = {
      name: 'test',
      version: '1.0.0',
      main: 'mod',
      dependencies: {},
      target: 'paper',
    }
    expect(manifest.target).toBe('paper')
  })

  it('target is optional', () => {
    const manifest: PackageManifest = {
      name: 'test',
      version: '1.0.0',
      main: 'mod',
      dependencies: {},
    }
    expect(manifest.target).toBeUndefined()
  })
})
