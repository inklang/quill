import { describe, it, expect } from 'vitest';
import { resolveTargetVersion, checkTargetVersionCompatibility } from '../../src/util/target-version.js';
import type { PackageManifest } from '../../src/model/manifest.js';

describe('resolveTargetVersion', () => {
  it('returns CLI flag version as highest priority', () => {
    const result = resolveTargetVersion({
      cliFlag: '1.21.4',
      buildConfig: '1.20.0',
      serverPaper: '1.22.0',
      activeTarget: 'paper',
    });
    expect(result).toBe('1.21.4');
  });

  it('returns build config version when no CLI flag', () => {
    const result = resolveTargetVersion({
      buildConfig: '1.20.0',
      serverPaper: '1.22.0',
      activeTarget: 'paper',
    });
    expect(result).toBe('1.20.0');
  });

  it('returns server paper version when no CLI flag or build config and target is paper', () => {
    const result = resolveTargetVersion({
      serverPaper: '1.22.0',
      activeTarget: 'paper',
    });
    expect(result).toBe('1.22.0');
  });

  it('returns null when no sources available', () => {
    const result = resolveTargetVersion({});
    expect(result).toBeNull();
  });

  it('ignores server paper for velocity target', () => {
    const result = resolveTargetVersion({
      serverPaper: '1.22.0',
      activeTarget: 'velocity',
    });
    expect(result).toBeNull();
  });

  it('ignores server paper when no active target is set (undefined)', () => {
    const result = resolveTargetVersion({
      serverPaper: '1.22.0',
    });
    expect(result).toBeNull();
  });

  it('uses server paper when active target is paper', () => {
    const result = resolveTargetVersion({
      serverPaper: '1.22.0',
      activeTarget: 'paper',
    });
    expect(result).toBe('1.22.0');
  });

  it('ignores non-semver server paper value', () => {
    const result = resolveTargetVersion({
      serverPaper: 'latest',
      activeTarget: 'paper',
    });
    expect(result).toBeNull();
  });
});

describe('checkTargetVersionCompatibility', () => {
  it('returns no issues when all dependencies are compatible', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.mobs': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.mobs', {
        name: 'ink.mobs',
        version: '1.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.mobs.MobsRuntime', targetVersion: '>=1.20.0 <1.23.0' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(0);
  });

  it('returns error when dependency version range is not satisfied', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.newfeature': '^2.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.newfeature', {
        name: 'ink.newfeature',
        version: '2.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.newfeature.Runtime', targetVersion: '>=1.22.0' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('error');
    expect(issues[0].package).toBe('ink.newfeature');
    expect(issues[0].message).toContain('>=1.22.0');
  });

  it('returns warning when dependency has no matching target', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.lib': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.lib', {
        name: 'ink.lib',
        version: '1.0.0',
        dependencies: {},
        targets: {
          velocity: { entry: 'org.ink.lib.VelocityRuntime' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('warn');
    expect(issues[0].package).toBe('ink.lib');
  });

  it('returns warning when dependency has matching target but no targetVersion', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.lib': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.lib', {
        name: 'ink.lib',
        version: '1.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.lib.PaperRuntime' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('warn');
  });

  it('returns error when dependency has invalid target-version range', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.bad': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.bad', {
        name: 'ink.bad',
        version: '1.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.bad.Runtime', targetVersion: 'bananas' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('error');
    expect(issues[0].message).toContain('bananas');
  });

  it('skips check when targetVersion is null', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.mobs': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.mobs', {
        name: 'ink.mobs',
        version: '1.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.mobs.MobsRuntime', targetVersion: '>=1.22.0' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', null);
    expect(issues).toHaveLength(0);
  });

  it('handles dependency declared in manifest but missing from dep manifests map', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.missing': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>();

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(0);
  });

  it('handles dependency with no targets at all (target-agnostic library)', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.core': '^1.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.core', {
        name: 'ink.core',
        version: '1.0.0',
        dependencies: {},
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(0);
  });

  it('checks multiple dependencies independently', () => {
    const manifest: PackageManifest = {
      name: 'my-project',
      version: '1.0.0',
      dependencies: {
        'ink.mobs': '^1.0.0',
        'ink.newfeature': '^2.0.0',
      },
    };
    const depManifests = new Map<string, PackageManifest>([
      ['ink.mobs', {
        name: 'ink.mobs',
        version: '1.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.mobs.MobsRuntime', targetVersion: '>=1.20.0 <1.23.0' },
        },
      }],
      ['ink.newfeature', {
        name: 'ink.newfeature',
        version: '2.0.0',
        dependencies: {},
        targets: {
          paper: { entry: 'org.ink.newfeature.Runtime', targetVersion: '>=1.22.0' },
        },
      }],
    ]);

    const issues = checkTargetVersionCompatibility(manifest, depManifests, 'paper', '1.21.4');
    expect(issues).toHaveLength(1);
    expect(issues[0].package).toBe('ink.newfeature');
    expect(issues[0].type).toBe('error');
  });
});
