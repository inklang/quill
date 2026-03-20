export interface PackageManifest {
  name: string;
  version: string;
  entry: string;
  dependencies: Record<string, string>;
}

export function defaultManifest(name: string): PackageManifest {
  return {
    name,
    version: '0.1.0',
    entry: 'mod',
    dependencies: {},
  };
}
