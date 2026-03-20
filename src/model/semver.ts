export class Semver {
  constructor(
    public readonly major: number,
    public readonly minor: number,
    public readonly patch: number
  ) {}

  static parse(s: string): Semver {
    const parts = s.split('.');
    if (parts.length !== 3) throw new Error(`Invalid semver: ${s}`);
    return new Semver(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }

  compareTo(other: Semver): number {
    if (this.major !== other.major) return this.major - other.major;
    if (this.minor !== other.minor) return this.minor - other.minor;
    return this.patch - other.patch;
  }

  toString(): string {
    return `${this.major}.${this.minor}.${this.patch}`;
  }
}

export class SemverRange {
  private readonly prefix: string | null;
  private readonly versionStr: string;

  constructor(range: string) {
    if (range.startsWith('^') || range.startsWith('~')) {
      this.prefix = range[0];
      this.versionStr = range.slice(1);
    } else {
      this.prefix = null;
      this.versionStr = range;
    }
  }

  matches(version: Semver): boolean {
    if (this.versionStr === '*') {
      return true;
    }

    const base = Semver.parse(this.versionStr);

    if (this.prefix === '^') {
      return (
        version.major === base.major &&
        (version.minor > base.minor ||
          (version.minor === base.minor && version.patch >= base.patch))
      );
    }

    if (this.prefix === '~') {
      return (
        version.major === base.major &&
        version.minor >= base.minor &&
        version.minor <= base.minor + 1
      );
    }

    return version.compareTo(base) === 0;
  }
}
