import { describe, it, expect } from 'vitest';
import { Lockfile, LockfileEntry } from '../src/lockfile.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Lockfile', () => {
  const tmpDir = os.tmpdir();

  it('writes and reads quill.lock roundtrip', () => {
    const lockfile = new Lockfile('https://packages.inklang.org', {
      'ink-core@1.0.0': new LockfileEntry('1.0.0', 'https://packages.inklang.org/ink-core-1.0.0.tar.gz'),
    });
    const filePath = path.join(tmpDir, 'quill.lock');
    lockfile.write(filePath);

    const loaded = Lockfile.read(filePath);
    expect(loaded.registry).toBe('https://packages.inklang.org');
    expect(loaded.packages['ink-core@1.0.0'].version).toBe('1.0.0');
    expect(loaded.packages['ink-core@1.0.0'].resolutionSource).toBe('https://packages.inklang.org/ink-core-1.0.0.tar.gz');

    fs.unlinkSync(filePath);
  });

  it('writes formatted JSON', () => {
    const lockfile = new Lockfile('https://packages.inklang.org', {
      'foo@1.0.0': new LockfileEntry('1.0.0', 'https://example.com/foo-1.0.0.tar.gz'),
    });
    const filePath = path.join(tmpDir, 'quill.lock');
    lockfile.write(filePath);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('"registry"');
    expect(content).toContain('"packages"');
    expect(content).toContain('"version"');

    fs.unlinkSync(filePath);
  });

  it('writes and reads entries with dependencies array', () => {
    const filePath = path.join(tmpDir, 'quill-lockfile-deps-test.lock');
    const entry = new LockfileEntry('1.2.0', 'https://example.com/pkg.tar.gz', ['dep-a@1.0.0', 'dep-b@2.0.0'])
    const lockfile = new Lockfile('https://registry.example.com', { 'pkg@1.2.0': entry })
    lockfile.write(filePath)

    const read = Lockfile.read(filePath)
    expect(read.packages['pkg@1.2.0'].version).toBe('1.2.0')
    expect(read.packages['pkg@1.2.0'].resolutionSource).toBe('https://example.com/pkg.tar.gz')
    expect(read.packages['pkg@1.2.0'].dependencies).toEqual(['dep-a@1.0.0', 'dep-b@2.0.0'])

    fs.unlinkSync(filePath)
  })

  it('defaults dependencies to empty array when not present in file', () => {
    const filePath = path.join(tmpDir, 'quill-lockfile-v1-test.lock');
    const v1Content = JSON.stringify({
      version: 1,
      registry: 'https://registry.example.com',
      packages: {
        'pkg@1.0.0': { version: '1.0.0', resolutionSource: 'https://example.com/pkg.tar.gz' }
      }
    }, null, 2)
    fs.writeFileSync(filePath, v1Content)

    const read = Lockfile.read(filePath)
    expect(read.packages['pkg@1.0.0'].dependencies).toEqual([])

    fs.unlinkSync(filePath)
  })

  it('writes version 2 format', () => {
    const filePath = path.join(tmpDir, 'quill-lockfile-v2-test.lock');
    const entry = new LockfileEntry('1.0.0', 'https://example.com/pkg.tar.gz')
    const lockfile = new Lockfile('https://registry.example.com', { 'pkg@1.0.0': entry })
    lockfile.write(filePath)

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    expect(raw.version).toBe(2)

    fs.unlinkSync(filePath)
  })
});