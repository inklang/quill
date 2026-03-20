import { Semver } from '../model/semver.js';
import { SemverRange } from '../model/semver.js';

export class RegistryPackageVersion {
  constructor(
    public readonly version: string,
    public readonly url: string,
    public readonly dependencies: Record<string, string>
  ) {}
}

export class RegistryPackage {
  constructor(
    public readonly name: string,
    public readonly versions: Map<string, RegistryPackageVersion>
  ) {}
}

export class RegistryClient {
  constructor(
    public readonly registryUrl: string = process.env['LECTERN_REGISTRY'] ?? 'https://packages.inklang.org'
  ) {}

  async fetchIndex(): Promise<object> {
    const url = `${this.registryUrl}/index.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch registry index: ${res.status}`);
    const json = await res.text();
    return this.parseIndex(json);
  }

  parseIndex(json: string): object {
    const data = JSON.parse(json);
    const packages = new Map<string, RegistryPackage>();

    for (const [pkgName, versions] of Object.entries<Record<string, any>>((data as any).packages ?? {})) {
      const versionMap = new Map<string, RegistryPackageVersion>();
      for (const [verStr, verData] of Object.entries<Record<string, any>>(versions)) {
        versionMap.set(verStr, new RegistryPackageVersion(
          verStr,
          verData.url ?? '',
          verData.dependencies ?? {}
        ));
      }
      packages.set(pkgName, new RegistryPackage(pkgName, versionMap));
    }

    const proxy = new Proxy(packages, {
      get(target, prop) {
        if (prop === 'size') return target.size;
        if (prop === 'get') return (key: string) => target.get(key);
        if (prop === 'getRegistryPackage') return (key: string) => target.get(key);
        if (typeof prop === 'symbol') return undefined;
        return target.get(prop);
      },
      ownKeys(target) {
        return [...target.keys()];
      },
      getOwnPropertyDescriptor(target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (target.has(prop)) {
          return {
            enumerable: true,
            configurable: true,
            value: target.get(prop)
          };
        }
        if (prop === 'size') {
          return {
            enumerable: false,
            configurable: true,
            value: target.size
          };
        }
        if (prop === 'get') {
          return {
            enumerable: false,
            configurable: true,
            value: (key: string) => target.get(key)
          };
        }
        return undefined;
      },
      has(target, prop) {
        if (typeof prop === 'symbol') return false;
        if (prop === 'size' || prop === 'get') return true;
        return target.has(prop);
      }
    });

    return proxy;
  }

  findBestMatch(
    index: object,
    pkgName: string,
    range: string
  ): RegistryPackageVersion | null {
    let pkg: RegistryPackage | undefined;

    if (index instanceof Map) {
      pkg = index.get(pkgName);
    } else {
      const getFn = (index as any).get || (index as any).getRegistryPackage;
      if (getFn) {
        pkg = getFn(pkgName);
      }
    }

    if (!pkg) return null;

    const semverRange = new SemverRange(range);

    let best: { ver: RegistryPackageVersion; parsed: Semver } | null = null;
    for (const [verStr, ver] of pkg.versions.entries()) {
      try {
        const parsed = Semver.parse(verStr);
        if (semverRange.matches(parsed)) {
          if (!best || parsed.compareTo(best.parsed) > 0) {
            best = { ver, parsed };
          }
        }
      } catch {}
    }

    return best?.ver ?? null;
  }
}
