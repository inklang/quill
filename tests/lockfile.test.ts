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
});