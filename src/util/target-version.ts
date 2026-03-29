import * as semver from 'semver';
import type { PackageManifest } from '../model/manifest.js';

export interface TargetVersionSource {
  cliFlag?: string;
  buildConfig?: string;
  serverPaper?: string;
  activeTarget?: string;
}

export interface VersionIssue {
  type: 'error' | 'warn';
  package: string;
  message: string;
}

/**
 * Resolve the active target version from multiple sources.
 * Priority: CLI flag > [build].target-version > [server].paper (paper target only)
 * Returns null if no version can be resolved.
 *
 * [server].paper is ONLY used when activeTarget is explicitly "paper".
 * If activeTarget is undefined or any other value, this source is skipped.
 */
export function resolveTargetVersion(sources: TargetVersionSource): string | null {
  // 1. CLI flag — highest priority
  if (sources.cliFlag) return sources.cliFlag;

  // 2. Build config
  if (sources.buildConfig) return sources.buildConfig;

  // 3. Server paper — paper target ONLY
  // Must be explicitly targeting paper to use [server].paper as a version source
  // Value must be valid semver (e.g. "1.21.4", not "latest")
  if (sources.serverPaper && sources.activeTarget === 'paper') {
    if (semver.valid(sources.serverPaper)) {
      return sources.serverPaper;
    }
    console.warn(`Warning: [server].paper value "${sources.serverPaper}" is not a valid semver version — skipping`);
  }

  // 4. No version resolved
  return null;
}

/**
 * Check all dependencies for target-version compatibility.
 * Returns a list of issues (errors and warnings).
 * If targetVersion is null, skips the check entirely.
 */
export function checkTargetVersionCompatibility(
  projectManifest: PackageManifest,
  depManifests: Map<string, PackageManifest>,
  activeTarget: string,
  targetVersion: string | null
): VersionIssue[] {
  if (targetVersion === null) return [];

  const issues: VersionIssue[] = [];

  for (const depName of Object.keys(projectManifest.dependencies ?? {})) {
    const depManifest = depManifests.get(depName);
    if (!depManifest) continue;

    // No targets at all — skip (target-agnostic library)
    if (!depManifest.targets || Object.keys(depManifest.targets).length === 0) continue;

    const targetConfig = depManifest.targets[activeTarget];

    // No matching target — warn
    if (!targetConfig) {
      issues.push({
        type: 'warn',
        package: depName,
        message: `No "${activeTarget}" target declared — version compatibility unknown`,
      });
      continue;
    }

    // Matching target but no targetVersion — warn
    if (!targetConfig.targetVersion) {
      issues.push({
        type: 'warn',
        package: depName,
        message: `No target-version declared for "${activeTarget}" — version compatibility unknown`,
      });
      continue;
    }

    // Validate the range syntax
    const range = targetConfig.targetVersion;
    if (!semver.validRange(range)) {
      issues.push({
        type: 'error',
        package: depName,
        message: `Invalid target-version range: "${range}"`,
      });
      continue;
    }

    // Check compatibility
    if (!semver.satisfies(targetVersion, range)) {
      issues.push({
        type: 'error',
        package: depName,
        message: `Requires ${activeTarget} ${range}, but project targets ${targetVersion}`,
      });
    }
  }

  return issues;
}
