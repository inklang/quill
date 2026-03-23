import { describe, it, expect } from 'vitest';
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

  describe('readAuthToken', () => {
    it('reads token from QUILL_TOKEN env var', () => {
      const original = process.env['QUILL_TOKEN']
      process.env['QUILL_TOKEN'] = 'test-token-123'
      try {
        const client = new RegistryClient()
        expect(client.readAuthToken()).toBe('test-token-123')
      } finally {
        if (original !== undefined) process.env['QUILL_TOKEN'] = original
        else delete process.env['QUILL_TOKEN']
      }
    })

    it('returns null when no token is available', () => {
      const original = process.env['QUILL_TOKEN']
      delete process.env['QUILL_TOKEN']
      try {
        const client = new RegistryClient()
        expect(client.readAuthToken()).toBeNull()
      } finally {
        if (original !== undefined) process.env['QUILL_TOKEN'] = original
      }
    })
  });
});
