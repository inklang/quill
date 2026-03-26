import fs from 'fs';

export class LockfileEntry {
  constructor(
    public readonly version: string,
    public readonly resolutionSource: string
  ) {}
}

export class Lockfile {
  constructor(
    public readonly registry: string,
    public readonly packages: Record<string, LockfileEntry>
  ) {}

  static read(filePath: string): Lockfile {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    const packages: Record<string, LockfileEntry> = {};

    for (const [key, val] of Object.entries<Record<string, any>>((data as any).packages ?? {})) {
      packages[key] = new LockfileEntry(val.version, val.resolutionSource);
    }

    return new Lockfile(data.registry ?? 'https://lectern.inklang.org', packages);
  }

  write(filePath: string): void {
    const packages: Record<string, any> = {};
    for (const [key, entry] of Object.entries(this.packages)) {
      packages[key] = {
        version: entry.version,
        resolutionSource: entry.resolutionSource,
      };
    }

    const content = JSON.stringify(
      {
        version: 1,
        registry: this.registry,
        packages,
      },
      null,
      2
    );

    fs.writeFileSync(filePath, content);
  }
}