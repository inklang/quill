import { describe, it, expect } from 'vitest';
import { TomlParser } from '../../src/util/toml.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('TomlParser with grammar', () => {
  const tmpDir = os.tmpdir();

  it('reads a quill.toml file with [grammar] section', () => {
    const content = `
[package]
name = "my-grammar-pkg"
version = "1.0.0"
entry = "mod"

[grammar]
entry = "grammar.ink"
output = "dist/grammar.js"

[dependencies]
ink-core = "^1.0.0"
`;
    const filePath = path.join(tmpDir, 'quill-grammar-test-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);

    const manifest = TomlParser.read(filePath);
    expect(manifest.name).toBe('my-grammar-pkg');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.main).toBe('mod');
    expect(manifest.grammar).toBeDefined();
    expect(manifest.grammar!.entry).toBe('grammar.ink');
    expect(manifest.grammar!.output).toBe('dist/grammar.js');
    expect(manifest.dependencies['ink-core']).toBe('^1.0.0');

    fs.unlinkSync(filePath);
  });

  it('write returns string and can be used with writeFileSync', () => {
    const manifest = {
      name: 'test-pkg',
      version: '0.2.0',
      main: 'main',
      dependencies: { 'ink-core': '^1.0.0' },
    };
    const filePath = path.join(tmpDir, 'quill-write-test-' + Date.now() + '.toml');

    const tomlString = TomlParser.write(manifest);
    fs.writeFileSync(filePath, tomlString);

    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toContain('name = "test-pkg"');
    expect(written).toContain('version = "0.2.0"');
    expect(written).toContain('ink-core = "^1.0.0"');

    fs.unlinkSync(filePath);
  });
});