import { describe, it, expect, beforeEach } from 'vitest';
import { FileUtils } from '../src/util/fs.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Convert Windows path to MSYS-compatible path for tar
function toMsysPath(winPath: string): string {
  return winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1');
}

describe('FileUtils', () => {
  const tmpDir = path.join(os.tmpdir(), 'quill-fs-test-' + Date.now());

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it('extracts tar.gz to destination', async () => {
    // Create a tarball with tar CLI
    const pkgDir = path.join(tmpDir, 'test-pkg');
    fs.mkdirSync(pkgDir);
    fs.writeFileSync(path.join(pkgDir, 'quill.toml'), 'name = "test"\nversion = "1.0.0"\nentry = "mod"\n');
    fs.writeFileSync(path.join(pkgDir, 'mod.ink'), '// test package\n');

    const tarball = path.join(tmpDir, 'test-pkg.tar.gz');
    await execAsync(`tar -czf "${toMsysPath(tarball)}" -C "${toMsysPath(pkgDir)}" .`);

    const extractDir = path.join(tmpDir, 'extracted');
    await FileUtils.extractTarGz(tarball, extractDir);

    expect(fs.existsSync(path.join(extractDir, 'quill.toml'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'mod.ink'))).toBe(true);
  });

  it('deletes directory recursively', () => {
    const dir = path.join(tmpDir, 'to-delete');
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nested', 'file.txt'), 'hello');

    FileUtils.deleteDirectory(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('ensures directory exists', () => {
    const dir = path.join(tmpDir, 'ensure', 'nested');
    FileUtils.ensureDir(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('downloads a file from URL', async () => {
    // Create a simple HTTP server... actually just test with a known public URL
    // We'll create a local test instead using a temp file
    const destPath = path.join(tmpDir, 'downloaded.txt');
    // Since we can't easily spin up an HTTP server in a test, we'll test the path.exists check path
    // Instead, test that downloadFile calls fetch (we can verify by it not throwing)
    // Use a known small file
    const url = 'https://httpbin.org/robots.txt';
    await FileUtils.downloadFile(url, destPath);
    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.readFileSync(destPath, 'utf-8')).toContain('Disallow');
  }, 30000);
});