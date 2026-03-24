import fs from 'fs';
import path from 'path';
import os from 'os';
import * as tar from 'tar';

export class FileUtils {
  /**
   * Extract a tar.gz archive to a destination directory.
   */
  static async extractTarGz(tarballPath: string, destDir: string): Promise<void> {
    fs.mkdirSync(destDir, { recursive: true });
    await tar.x({ file: tarballPath, cwd: destDir });
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
   * Download a file atomically: stream to dest+'.tmp', then rename on success.
   * Uses fetch() which auto-follows HTTP redirects (required for GitHub releases URLs).
   * If interrupted, the .tmp file is left behind and will be retried on next call.
   */
  static async downloadFileAtomic(url: string, destPath: string): Promise<void> {
    const tmpPath = destPath + '.tmp';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
    const buf = await res.arrayBuffer();
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(tmpPath, Buffer.from(buf));
    fs.renameSync(tmpPath, destPath);
  }

  /**
   * Pack files into a tar.gz archive.
   */
  static async packTarGz(sourceDir: string, destPath: string, includes: string[]): Promise<void> {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    await tar.c({ gzip: true, file: destPath, cwd: sourceDir }, includes);
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