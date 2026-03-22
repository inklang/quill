import * as toml from '@iarna/toml';
import fs from 'fs';
import path from 'path';
import { PackageManifest } from '../model/manifest.js';

export class TomlParser {
  static read(filePath: string): PackageManifest {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = toml.parse(content);

    const pkg = (data as any).package;
    if (!pkg) throw new Error('ink-package.toml is missing [package] section');
    if (!pkg.name) throw new Error('ink-package.toml is missing package.name');

    const grammarSection = (data as any).grammar;
    return {
      name: pkg.name,
      version: pkg.version ?? '0.0.0',
      entry: pkg.entry ?? 'main',
      dependencies: (data.dependencies as Record<string, string>) ?? {},
      grammar: grammarSection ? {
        entry: grammarSection.entry,
        output: grammarSection.output,
      } : undefined,
    };
  }

  static write(manifest: PackageManifest): string {
    return toml.stringify(manifest as any);
  }
}