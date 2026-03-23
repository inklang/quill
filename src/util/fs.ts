import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

// Convert Windows path to MSYS-compatible path for tar
function toMsysPath(winPath: string): string {
  return winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1');
}

export class FileUtils {
  /**
   * Extract a tar.gz archive to a destination directory.
   */
  static async extractTarGz(tarballPath: string, destDir: string): Promise<void> {
    fs.mkdirSync(destDir, { recursive: true });
    // Use tar CLI — most portable across platforms
    await execAsync(`tar -xzf "${toMsysPath(tarballPath)}" -C "${toMsysPath(destDir)}"`);
  }

  /**
   * Download a file from URL to destination path.
   */
  static async downloadFile(url: string, destPath: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
    const buf = await res.arrayBuffer();
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, Buffer.from(buf));
  }

  /**
   * Pack files into a tar.gz archive.
   */
  static async packTarGz(sourceDir: string, destPath: string, includes: string[]): Promise<void> {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const includeArgs = includes.map(i => `"${i}"`).join(' ');
    await execAsync(`tar -czf "${toMsysPath(destPath)}" ${includeArgs}`, { cwd: sourceDir });
  }

  /**
   * Delete a directory recursively.
   */
  static deleteDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) return;
    fs.rmSync(dirPath, { recursive: true, force: true });
  }

  /**
   * Ensure a directory exists (create if missing).
   */
  static ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  /**
   * Get temp directory for this session.
   */
  static tmpDir(): string {
    return os.tmpdir();
  }
}