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

describe('TomlParser with server section', () => {
  const tmpDir = os.tmpdir();

  it('parses [server] section with all fields', () => {
    const content = `
[package]
name = "my-project"
version = "0.1.0"
main = "main"

[server]
paper = "1.21.4"
jar = "path/to/paper.jar"
path = "/custom/server"
`;
    const filePath = path.join(tmpDir, 'quill-server-test-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);

    const manifest = TomlParser.read(filePath);
    expect(manifest.server).toBeDefined();
    expect(manifest.server!.paper).toBe('1.21.4');
    // jar must be preserved exactly as written — resolution happens at runtime, not parse time
    expect(manifest.server!.jar).toBe('path/to/paper.jar');
    expect(manifest.server!.path).toBe('/custom/server');

    fs.unlinkSync(filePath);
  });

  it('parses [server] section with only paper field', () => {
    const content = `
[package]
name = "my-project"
version = "0.1.0"
main = "main"

[server]
paper = "1.20.1"
`;
    const filePath = path.join(tmpDir, 'quill-server-paper-only-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);

    const manifest = TomlParser.read(filePath);
    expect(manifest.server).toBeDefined();
    expect(manifest.server!.paper).toBe('1.20.1');
    expect(manifest.server!.jar).toBeUndefined();
    expect(manifest.server!.path).toBeUndefined();

    fs.unlinkSync(filePath);
  });

  it('returns undefined server when [server] section is absent', () => {
    const content = `
[package]
name = "my-project"
version = "0.1.0"
main = "main"
`;
    const filePath = path.join(tmpDir, 'quill-no-server-test-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);

    const manifest = TomlParser.read(filePath);
    expect(manifest.server).toBeUndefined();

    fs.unlinkSync(filePath);
  });
});