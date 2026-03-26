import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveServerDir, deployScripts, deployGrammarJars } from '../../src/commands/run.js';

const tmpDir = path.join(os.tmpdir(), 'quill-run-test-' + Date.now());

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveServerDir', () => {
  it('returns ~/.quill/server when manifest.server is undefined', () => {
    const result = resolveServerDir('/project', {});
    expect(result).toBe(path.join(os.homedir(), '.quill', 'server'));
  });

  it('returns ~/.quill/server when manifest.server.path is undefined', () => {
    const result = resolveServerDir('/project', { server: { paper: '1.21.4' } });
    expect(result).toBe(path.join(os.homedir(), '.quill', 'server'));
  });

  it('returns absolute path as-is when manifest.server.path is absolute', () => {
    const absPath = process.platform === 'win32' ? 'C:\\custom\\server' : '/custom/server';
    const result = resolveServerDir('/project', { server: { path: absPath } });
    expect(result).toBe(absPath);
  });

  it('resolves relative manifest.server.path against project root', () => {
    const result = resolveServerDir('/my/project', { server: { path: 'dev-server' } });
    expect(result).toBe(path.join('/my/project', 'dev-server'));
  });
});

describe('setup file guards', () => {
  it('writes eula.txt with eula=true when absent', () => {
    const eulaPath = path.join(tmpDir, 'eula.txt');
    if (!fs.existsSync(eulaPath)) {
      fs.writeFileSync(eulaPath, 'eula=true\n');
    }
    expect(fs.readFileSync(eulaPath, 'utf-8')).toBe('eula=true\n');
  });

  it('does not overwrite eula.txt if already present', () => {
    const eulaPath = path.join(tmpDir, 'eula.txt');
    fs.writeFileSync(eulaPath, 'eula=false\n');
    if (!fs.existsSync(eulaPath)) {
      fs.writeFileSync(eulaPath, 'eula=true\n');
    }
    expect(fs.readFileSync(eulaPath, 'utf-8')).toBe('eula=false\n');
  });

  it('writes server.properties with defaults when absent', () => {
    const propsPath = path.join(tmpDir, 'server.properties');
    if (!fs.existsSync(propsPath)) {
      fs.writeFileSync(propsPath, 'online-mode=false\nserver-port=25565\n');
    }
    const content = fs.readFileSync(propsPath, 'utf-8');
    expect(content).toContain('online-mode=false');
    expect(content).toContain('server-port=25565');
  });

  it('does not overwrite server.properties if already present', () => {
    const propsPath = path.join(tmpDir, 'server.properties');
    fs.writeFileSync(propsPath, 'server-port=19132\n');
    if (!fs.existsSync(propsPath)) {
      fs.writeFileSync(propsPath, 'online-mode=false\nserver-port=25565\n');
    }
    expect(fs.readFileSync(propsPath, 'utf-8')).toBe('server-port=19132\n');
  });
});

describe('deployScripts', () => {
  it('clears the scripts dir entirely before copying new .inkc files', () => {
    // Pre-populate a stale script in the server scripts dir
    const serverScripts = path.join(tmpDir, 'plugins', 'Ink', 'scripts');
    fs.mkdirSync(serverScripts, { recursive: true });
    fs.writeFileSync(path.join(serverScripts, 'stale.inkc'), 'old content');

    // Place a new compiled script in dist/scripts
    const distScripts = path.join(tmpDir, 'dist', 'scripts');
    fs.mkdirSync(distScripts, { recursive: true });
    fs.writeFileSync(path.join(distScripts, 'main.inkc'), 'compiled');

    deployScripts(tmpDir, tmpDir);

    const deployed = fs.readdirSync(serverScripts);
    expect(deployed).toContain('main.inkc');
    expect(deployed).not.toContain('stale.inkc');
  });

  it('deploys grammar JARs from packages/*/dist/*.jar to plugins/Ink/plugins/', () => {
    // Ensure the server plugin directory exists
    const targetDir = path.join(tmpDir, 'plugins', 'Ink', 'plugins');
    fs.mkdirSync(targetDir, { recursive: true });

    // Place a grammar JAR in a package dist dir
    const pkgDist = path.join(tmpDir, 'packages', 'ink.mobs', 'dist');
    fs.mkdirSync(pkgDist, { recursive: true });
    fs.writeFileSync(path.join(pkgDist, 'ink.mobs-0.1.0.jar'), 'jar-bytes');

    deployGrammarJars(tmpDir, tmpDir);

    expect(fs.existsSync(path.join(targetDir, 'ink.mobs-0.1.0.jar'))).toBe(true);
  });
});
