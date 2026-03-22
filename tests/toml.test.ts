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
    expect(manifest.main).toBe('mod');
    expect(manifest.dependencies['ink-core']).toBe('^1.0.0');

    fs.unlinkSync(filePath);
  });

  it('writes a quill.toml file', () => {
    const manifest = {
      name: 'test-pkg',
      version: '0.2.0',
      main: 'main',
      dependencies: { 'ink-core': '^1.0.0' },
    };
    const filePath = path.join(tmpDir, 'quill-write-test-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, TomlParser.write(manifest));

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

  it('reads [runtime] section', () => {
    const content = `
[package]
name = "ink.mobs"
version = "1.0.0"
main = "mod"

[dependencies]

[runtime]
jar = "runtime/mobs-runtime.jar"
entry = "org.ink.mobs.MobsRuntime"
`;
    const filePath = path.join(tmpDir, 'quill-runtime-test-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);

    const manifest = TomlParser.read(filePath);
    expect(manifest.runtime).toBeDefined();
    expect(manifest.runtime!.jar).toBe('runtime/mobs-runtime.jar');
    expect(manifest.runtime!.entry).toBe('org.ink.mobs.MobsRuntime');

    fs.unlinkSync(filePath);
  });

  it('reads description and author fields', () => {
    const content = `
[package]
name = "ink.mobs"
version = "1.0.0"
description = "Mob declarations"
author = "testauthor"
main = "mod"

[dependencies]
`;
    const filePath = path.join(tmpDir, 'quill-meta-test-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);

    const manifest = TomlParser.read(filePath);
    expect(manifest.description).toBe('Mob declarations');
    expect(manifest.author).toBe('testauthor');

    fs.unlinkSync(filePath);
  });

  it('runtime and grammar are undefined when absent', () => {
    const content = `
[package]
name = "ink.scripts"
version = "0.1.0"
main = "mod"

[dependencies]
`;
    const filePath = path.join(tmpDir, 'quill-minimal-test-' + Date.now() + '.toml');
    fs.writeFileSync(filePath, content);

    const manifest = TomlParser.read(filePath);
    expect(manifest.grammar).toBeUndefined();
    expect(manifest.runtime).toBeUndefined();

    fs.unlinkSync(filePath);
  });

  it('write() output can be read back by read()', () => {
    const manifest: import('../model/manifest.js').PackageManifest = {
      name: 'ink.roundtrip',
      version: '1.0.0',
      main: 'mod',
      dependencies: { 'ink.core': '>=1.0.0' },
      grammar: { entry: 'src/grammar.ts', output: 'dist/grammar.ir.json' },
      runtime: { jar: 'runtime/test.jar', entry: 'ink.test.TestRuntime' },
    }
    const tomlStr = TomlParser.write(manifest)
    const tmpPath = path.join(os.tmpdir(), `toml-roundtrip-${Date.now()}.toml`)
    fs.writeFileSync(tmpPath, tomlStr)
    try {
      const parsed = TomlParser.read(tmpPath)
      expect(parsed.name).toBe('ink.roundtrip')
      expect(parsed.version).toBe('1.0.0')
      expect(parsed.grammar?.entry).toBe('src/grammar.ts')
      expect(parsed.runtime?.jar).toBe('runtime/test.jar')
    } finally {
      fs.unlinkSync(tmpPath)
    }
  });
});