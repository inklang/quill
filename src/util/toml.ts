import * as toml from '@iarna/toml';
import fs from 'fs';
import path from 'path';
import { PackageManifest, TargetConfig } from '../model/manifest.js';

export class TomlParser {
  static read(filePath: string): PackageManifest {
    const content = fs.readFileSync(filePath, 'utf-8');
    return TomlParser.readFromString(content);
  }

  static readFromString(content: string): PackageManifest {
    const data = toml.parse(content);
    const pkg = (data as any).package;
    if (!pkg) throw new Error('ink-package.toml is missing [package] section');
    if (!pkg.name) throw new Error('ink-package.toml is missing package.name');

    // Parse and validate type field
    const VALID_TYPES = ['script', 'library'] as const;
    let packageType: 'script' | 'library' = pkg.type ?? 'script';
    if (!VALID_TYPES.includes(packageType as any)) {
      throw new Error(`invalid package type: "${pkg.type}". Must be "script" or "library".`);
    }

    const grammarSection = (data as any).grammar;
    const buildSection = (data as any).build;
    const runtimeSection = (data as any).runtime;
    const serverSection = (data as any).server;

    // Parse targets section
    const targetsSection = (data as any).targets;
    const targets: Record<string, TargetConfig> | undefined = targetsSection
      ? Object.fromEntries(
          Object.entries(targetsSection).map(([name, cfg]: [string, any]) => [name, {
            entry: cfg.entry,
            jar: cfg.jar,
            jvmArgs: cfg['jvm-args'],
            env: cfg.env,
            targetVersion: cfg['target-version'],
          }])
        )
      : undefined;

    // Legacy single runtime — migrate to targets.default
    if (runtimeSection && !targets) {
      return {
        name: pkg.name,
        version: pkg.version ?? '0.0.0',
        type: packageType,
        description: pkg.description,
        author: pkg.author,
        homepage: pkg.homepage,
        repository: pkg.repository,
        main: packageType === 'script' ? (pkg.main ?? pkg.entry ?? 'main') : (pkg.main ?? pkg.entry),
        dependencies: (data.dependencies as Record<string, string>) ?? {},
        grammar: grammarSection ? { entry: grammarSection.entry, output: grammarSection.output } : undefined,
        build: buildSection ? { compiler: buildSection.compiler, target: buildSection.target, targetVersion: buildSection['target-version'], entry: buildSection.entry } : undefined,
        runtime: { jar: runtimeSection.jar, entry: runtimeSection.entry },
        server: serverSection ? { paper: serverSection.paper, jar: serverSection.jar, path: serverSection.path } : undefined,
        targets: { default: { entry: runtimeSection.entry, jar: runtimeSection.jar } },
      };
    }

    return {
      name: pkg.name,
      version: pkg.version ?? '0.0.0',
      type: packageType,
      description: pkg.description,
      author: pkg.author,
      homepage: pkg.homepage,
      repository: pkg.repository,
      main: packageType === 'script' ? (pkg.main ?? pkg.entry ?? 'main') : (pkg.main ?? pkg.entry),
      target: pkg.target,
      dependencies: (data.dependencies as Record<string, string>) ?? {},
      grammar: grammarSection ? { entry: grammarSection.entry, output: grammarSection.output } : undefined,
      build: buildSection ? { compiler: buildSection.compiler, target: buildSection.target, targetVersion: buildSection['target-version'], entry: buildSection.entry } : undefined,
      runtime: runtimeSection ? { jar: runtimeSection.jar, entry: runtimeSection.entry } : undefined,
      server: serverSection ? { paper: serverSection.paper, jar: serverSection.jar, path: serverSection.path } : undefined,
      targets,
    };
  }

  static write(manifest: PackageManifest): string {
    const data: Record<string, unknown> = {
      package: {
        name: manifest.name,
        version: manifest.version,
        ...(manifest.type ? { type: manifest.type } : {}),
        ...(manifest.main ? { main: manifest.main } : {}),
        ...(manifest.description ? { description: manifest.description } : {}),
        ...(manifest.author ? { author: manifest.author } : {}),
        ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
        ...(manifest.repository ? { repository: manifest.repository } : {}),
        ...(manifest.target ? { target: manifest.target } : {}),
      },
      dependencies: manifest.dependencies,
    };
    if (manifest.grammar) data.grammar = manifest.grammar;
    if (manifest.build) {
      const { targetVersion, ...rest } = manifest.build;
      data.build = { ...rest, ...(targetVersion ? { 'target-version': targetVersion } : {}) };
    }
    if (manifest.runtime) data.runtime = manifest.runtime;
    if (manifest.server) data.server = manifest.server;
    if (manifest.targets) {
      data.targets = {};
      for (const [name, cfg] of Object.entries(manifest.targets)) {
        (data.targets as Record<string, any>)[name] = {
          entry: cfg.entry,
          ...(cfg.jar ? { jar: cfg.jar } : {}),
          ...(cfg.jvmArgs?.length ? { 'jvm-args': cfg.jvmArgs } : {}),
          ...(cfg.env && Object.keys(cfg.env).length ? { env: cfg.env } : {}),
          ...(cfg.targetVersion ? { 'target-version': cfg.targetVersion } : {}),
        };
      }
    }
    return toml.stringify(data as any);
  }
}
