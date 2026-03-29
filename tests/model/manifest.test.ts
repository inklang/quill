import { describe, it, expect } from 'vitest'
import { defaultManifest, type PackageManifest } from '../../src/model/manifest'

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

  it('defaultManifest includes type: "script"', () => {
    const m = defaultManifest('test-pkg');
    expect(m.type).toBe('script');
    expect(m.main).toBe('mod');
  });

  it('library manifest can omit main', () => {
    const m: PackageManifest = {
      name: 'ink.mobs',
      version: '0.1.0',
      type: 'library',
      dependencies: {},
    };
    expect(m.type).toBe('library');
    expect(m.main).toBeUndefined();
  });
})
