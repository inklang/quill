import { describe, it, expect } from 'vitest';
import { TomlParser } from '../src/util/toml.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('TomlParser', () => {
  const tmpDir = os.tmpdir();

  it('reads a quill.toml file', () => {
    const content = `
[package]
name = "my-pkg"
version = "1.0.0"
entry = "mod"

[dependencies]
ink-core = "^1.0.0"
`;
    const filePath = path.join(tmpDir, 'quill-test-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);

    const manifest = TomlParser.read(filePath);
    expect(manifest.name).toBe('my-pkg');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.entry).toBe('mod');
    expect(manifest.dependencies['ink-core']).toBe('^1.0.0');

    fs.unlinkSync(filePath);
  });

  it('writes a quill.toml file', () => {
    const manifest = {
      name: 'test-pkg',
      version: '0.2.0',
      entry: 'main',
      dependencies: { 'ink-core': '^1.0.0' },
    };
    const filePath = path.join(tmpDir, 'quill-write-test-' + Date.now() + '.toml');
    TomlParser.write(manifest, filePath);

    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toContain('name = "test-pkg"');
    expect(written).toContain('version = "0.2.0"');
    expect(written).toContain('ink-core = "^1.0.0"');

    fs.unlinkSync(filePath);
  });

  it('throws when quill.toml is missing [package]', () => {
    const filePath = path.join(tmpDir, 'bad-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, '[dependencies]\nink-core = "^1.0.0"');
    expect(() => TomlParser.read(filePath)).toThrow('missing [package] section');
    fs.unlinkSync(filePath);
  });

  it('throws when package.name is missing', () => {
    const filePath = path.join(tmpDir, 'bad2-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, '[package]\nversion = "1.0.0"');
    expect(() => TomlParser.read(filePath)).toThrow('missing package.name');
    fs.unlinkSync(filePath);
  });
});