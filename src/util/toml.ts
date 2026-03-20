import toml from 'toml';
import fs from 'fs';
import path from 'path';
import { PackageManifest } from '../model/manifest.js';

export class TomlParser {
  static read(filePath: string): PackageManifest {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = toml.parse(content);

    const pkg = (data as any).package;
    if (!pkg) throw new Error('quill.toml is missing [package] section');
    if (!pkg.name) throw new Error('quill.toml is missing package.name');

    return {
      name: pkg.name,
      version: pkg.version ?? '0.0.0',
      entry: pkg.entry ?? 'main',
      dependencies: (data.dependencies as Record<string, string>) ?? {},
    };
  }

  static write(manifest: PackageManifest, filePath: string): void {
    const depsLines = Object.entries(manifest.dependencies)
      .map(([k, v]) => `${k} = "${v}"`)
      .join('\n');

    const content = `[package]
name = "${manifest.name}"
version = "${manifest.version}"
entry = "${manifest.entry}"
${depsLines ? '\n[dependencies]\n' + depsLines : ''}
`;
    fs.mkdirSync(path.dirname(filePath) || '.', { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}