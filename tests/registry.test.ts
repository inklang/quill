import { describe, it, expect, vi } from 'vitest';
import { RegistryClient, RegistryPackage, RegistryPackageVersion } from '../src/registry/client.js';
import { Semver } from '../src/model/semver.js';
import { SemverRange } from '../src/model/semver.js';

describe('RegistryClient', () => {
  describe('parseIndex', () => {
    it('parses index.json correctly', () => {
      const client = new RegistryClient('https://example.com');
      const json = JSON.stringify({
        packages: {
          'ink-core': {
            '1.0.0': {
              url: 'https://example.com/ink-core-1.0.0.tar.gz',
              dependencies: {},
            },
            '1.1.0': {
              url: 'https://example.com/ink-core-1.1.0.tar.gz',
              dependencies: { utils: '1.0.0' },
            },
          },
        },
      });
      const index = client.parseIndex(json);
      expect(Object.keys(index).length).toBe(1);
      const pkg = index.get('ink-core');
      expect(pkg).toBeDefined();
      expect(pkg!.versions.size).toBe(2);
    });

    it('handles empty packages', () => {
      const client = new RegistryClient('https://example.com');
      const index = client.parseIndex('{}');
      expect(index.size).toBe(0);
    });
  });

  describe('findBestMatch', () => {
    it('finds best matching version with caret range', () => {
      const client = new RegistryClient('https://example.com');
      const index = new Map<string, RegistryPackage>();
      index.set('ink-core', new RegistryPackage('ink-core', new Map([
        ['1.0.0', new RegistryPackageVersion('1.0.0', 'url1', {})],
        ['1.1.0', new RegistryPackageVersion('1.1.0', 'url2', {})],
        ['2.0.0', new RegistryPackageVersion('2.0.0', 'url3', {})],
      ])));

      const result = client.findBestMatch(index, 'ink-core', '^1.0.0');
      expect(result?.version).toBe('1.1.0');
    });

    it('returns null when no version satisfies range', () => {
      const client = new RegistryClient('https://example.com');
      const index = new Map<string, RegistryPackage>();
      index.set('ink-core', new RegistryPackage('ink-core', new Map([
        ['1.0.0', new RegistryPackageVersion('1.0.0', 'url1', {})],
      ])));

      const result = client.findBestMatch(index, 'ink-core', '^2.0.0');
      expect(result).toBeNull();
    });

    it('returns null when package not found', () => {
      const client = new RegistryClient('https://example.com');
      const index = new Map<string, RegistryPackage>();
      const result = client.findBestMatch(index, 'nonexistent', '^1.0.0');
      expect(result).toBeNull();
    });

    it('finds best matching version with exact range', () => {
      const client = new RegistryClient('https://example.com');
      const index = new Map<string, RegistryPackage>();
      index.set('ink-core', new RegistryPackage('ink-core', new Map([
        ['1.0.0', new RegistryPackageVersion('1.0.0', 'url1', {})],
        ['2.0.0', new RegistryPackageVersion('2.0.0', 'url2', {})],
      ])));

      const result = client.findBestMatch(index, 'ink-core', '1.0.0');
      expect(result?.version).toBe('1.0.0');
    });
  });

  describe('makeAuthHeader', () => {
    it('returns null when no keypair is available', async () => {
      vi.spyOn(await import('../src/util/keys.js'), 'readRc').mockReturnValue(null)
      const client = new RegistryClient()
      expect(client.makeAuthHeader()).toBeNull()
    })

    it('returns Ink-v1 header when keypair is present', async () => {
      const { generateKeypair } = await import('../src/util/keys.js')
      const { keyId, privateKeyB64 } = generateKeypair()
      vi.spyOn(await import('../src/util/keys.js'), 'readRc').mockReturnValue({
        keyId, privateKey: privateKeyB64, username: 'test', registry: 'https://example.com'
      })
      const client = new RegistryClient()
      const header = client.makeAuthHeader()
      expect(header).not.toBeNull()
      expect(header).toMatch(/^Ink-v1 keyId=/)
    })
  });
});
