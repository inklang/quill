import { describe, it, expect } from 'vitest'
import { RegistryClient } from '../../src/registry/client'

describe('RegistryClient', () => {
  describe('parseIndex', () => {
    it('parses targets field from package version', () => {
      const client = new RegistryClient()
      const json = JSON.stringify({
        packages: {
          'ink.mobs': {
            '1.0.0': {
              url: 'https://example.com/ink.mobs-1.0.0.tar.gz',
              dependencies: {},
              targets: ['paper', 'wasm'],
            }
          }
        }
      })
      const index = client.parseIndex(json)
      const pkg = (index as any).get('ink.mobs')
      expect(pkg).toBeDefined()
      const ver = pkg.versions.get('1.0.0')
      expect(ver.targets).toEqual(['paper', 'wasm'])
    })

    it('targets is undefined when not present', () => {
      const client = new RegistryClient()
      const json = JSON.stringify({
        packages: {
          'ink.mobs': {
            '1.0.0': {
              url: 'https://example.com/ink.mobs-1.0.0.tar.gz',
              dependencies: {},
            }
          }
        }
      })
      const index = client.parseIndex(json)
      const pkg = (index as any).get('ink.mobs')
      const ver = pkg.versions.get('1.0.0')
      expect(ver.targets).toBeUndefined()
    })

    it('parses package_type from version data', () => {
      const json = JSON.stringify({
        packages: {
          'ink.mobs': {
            '1.0.0': {
              url: 'https://example.com/ink.mobs-1.0.0.tar.gz',
              dependencies: {},
              package_type: 'library',
            }
          }
        }
      })
      const index = new RegistryClient().parseIndex(json)
      const pkg = (index as any).get('ink.mobs')
      expect(pkg?.versions.get('1.0.0')?.packageType).toBe('library')
    })

    it('package_type defaults to "script" when absent', () => {
      const json = JSON.stringify({
        packages: {
          'my-game': {
            '1.0.0': {
              url: 'https://example.com/my-game-1.0.0.tar.gz',
              dependencies: {},
            }
          }
        }
      })
      const index = new RegistryClient().parseIndex(json)
      const pkg = (index as any).get('my-game')
      expect(pkg?.versions.get('1.0.0')?.packageType).toBe('script')
    })

    it('parseIndex reads checksum from version data', () => {
      const json = JSON.stringify({
        packages: {
          'test.pkg': {
            '1.0.0': {
              url: 'http://example.com/test.pkg-1.0.0.tar.gz',
              dependencies: {},
              checksum: 'sha256:abc123',
            }
          }
        }
      })
      const index = new RegistryClient().parseIndex(json)
      const pkg = index.get('test.pkg')
      expect(pkg?.versions.get('1.0.0')?.checksum).toBe('sha256:abc123')
    })
  })
})
