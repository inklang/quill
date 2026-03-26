export interface GrammarConfig {
  entry: string;
  output: string;
}

export interface RuntimeConfig {
  jar: string;
  entry: string;
}

export interface ServerConfig {
  paper?: string;
  jar?: string;
  path?: string;
}

export interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  dependencies: Record<string, string>;
  target?: string;
  grammar?: GrammarConfig;
  runtime?: RuntimeConfig;
  server?: ServerConfig;
}

export function defaultManifest(name: string): PackageManifest {
  return {
    name,
    version: '0.1.0',
    main: 'mod',
    dependencies: {},
  };
}
