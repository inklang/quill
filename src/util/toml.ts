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
    const runtimeSection = (data as any).runtime;
    const serverSection = (data as any).server;
    return {
      name: pkg.name,
      version: pkg.version ?? '0.0.0',
      description: pkg.description,
      author: pkg.author,
      main: pkg.main ?? pkg.entry ?? 'main',
      dependencies: (data.dependencies as Record<string, string>) ?? {},
      grammar: grammarSection ? {
        entry: grammarSection.entry,
        output: grammarSection.output,
      } : undefined,
      runtime: runtimeSection ? {
        jar: runtimeSection.jar,
        entry: runtimeSection.entry,
      } : undefined,
      server: serverSection ? {
        paper: serverSection.paper,
        jar: serverSection.jar,
        path: serverSection.path,
      } : undefined,
    };
  }

  static write(manifest: PackageManifest): string {
    const data: Record<string, unknown> = {
      package: {
        name: manifest.name,
        version: manifest.version,
        main: manifest.main,
        ...(manifest.description ? { description: manifest.description } : {}),
        ...(manifest.author ? { author: manifest.author } : {}),
      },
      dependencies: manifest.dependencies,
    };
    if (manifest.grammar) data.grammar = manifest.grammar;
    if (manifest.runtime) data.runtime = manifest.runtime;
    if (manifest.server) data.server = manifest.server;
    return toml.stringify(data as any);
  }
}