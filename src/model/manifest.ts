export interface GrammarConfig {
  entry: string;
  output: string;
}

export interface RuntimeConfig {
  jar: string;
  entry: string;
}

export interface TargetConfig {
  entry: string;
  jar?: string;  // For legacy external JAR projects
  jvmArgs?: string[];
  env?: Record<string, string>;
}

export interface BuildConfig {
  compiler?: string;
  target?: string;
  targetVersion?: string;
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
  homepage?: string;
  repository?: string;
  main: string;
  dependencies: Record<string, string>;
  target?: string;
  grammar?: GrammarConfig;
  build?: BuildConfig;
  runtime?: RuntimeConfig;  // Legacy
  server?: ServerConfig;    // Server config
  targets?: Record<string, TargetConfig>;  // Multi-target support
}

export function defaultManifest(name: string): PackageManifest {
  return {
    name,
    version: '0.1.0',
    main: 'mod',
    dependencies: {},
    targets: {},
  };
}
