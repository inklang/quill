import { FileUtils } from '../util/fs.js';
import path from 'path';
import fs from 'fs';

export class CleanCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const cacheDir = path.join(this.projectDir, '.quill-cache');
    if (!fs.existsSync(cacheDir)) {
      console.log('Nothing to clean (.quill-cache/ does not exist).');
      return;
    }
    FileUtils.deleteDirectory(cacheDir);
    console.log('Removed .quill-cache/');
  }
}
