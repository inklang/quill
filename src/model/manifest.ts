export interface GrammarConfig {
  entry: string;
  output: string;
}

export interface PackageManifest {
  name: string;
  version: string;
  entry: string;
  dependencies: Record<string, string>;
  grammar?: GrammarConfig;
}

export function defaultManifest(name: string): PackageManifest {
  return {
    name,
    version: '0.1.0',
    entry: 'mod',
    dependencies: {},
  };
}
