# Transitive Dependency Resolution for `quill add`

**Date:** 2026-03-28

## Summary

Make `quill add` resolve and install transitive dependencies automatically. Remove `quill install` — `add` is now the sole entry point for pulling packages.

## Motivation

Currently `quill add` and `quill install` only install direct dependencies. If package A depends on package B, running `quill add A` does not install B. There is no command that resolves the full dependency tree. The `install` command is redundant — it only iterates `ink-package.toml` dependencies without recursion.

## Design

### Resolution Algorithm

When `quill add <pkg>` runs:

1. Resolve the direct package via `findBestMatch` (unchanged)
2. Read that package's `dependencies` from the registry index (`RegistryPackageVersion.dependencies`)
3. For each dependency, resolve via `findBestMatch`
   - If the package is already in the resolved set, verify the resolved version satisfies the new range
   - If not, re-resolve to find a version satisfying **all** accumulated ranges
   - If no single version satisfies all ranges, error with a clear message showing the conflicting requirements
4. Recurse into each newly resolved package's dependencies
5. Track a visited set to prevent cycles

Output: a flat `Map<string, ResolvedPkg>` keyed by package name.

### Download & Install Phase

After resolution:

1. Filter out packages already present in `packages/` directory
2. Download all new packages in batches of 3
3. Extract each — apply existing target-matching logic (find matching target subfolder via `ink-manifest.json`)
4. Flat layout: all deps go to `packages/<dep-name>/`
5. Checksum verification runs on every downloaded tarball — abort all if any fail
6. Vulnerability audit runs on the direct package only (transitive deps don't trigger interactive prompts)

### Lock File & Manifest

- **`ink-package.toml`** — only the direct package is added to `dependencies`
- **`quill.lock`** — updated with the full resolved set; transitive deps get lock entries alongside the direct dep. Existing entries preserved; only new/changed entries added. Compatible locked versions are kept as-is to avoid churn.

### Remove `quill install`

- Delete `src/commands/install.ts`
- Remove `InstallCommand` import and `.command('install')` registration from `src/cli.ts`
- Remove from help grouping in `cli.ts`

## Scope

- Changes: `src/commands/add.ts`, `src/cli.ts`
- Deleted: `src/commands/install.ts`
- No changes to: registry client, lock file format, toml parser

## Version Conflict Example

```
ink.mobs depends on ink.utils ^1.0.0
ink.items depends on ink.utils ^1.2.0
```

Resolution: find highest version satisfying both `^1.0.0` AND `^1.2.0` → e.g. `1.5.0`.

```
ink.mobs depends on ink.utils ^1.0.0
ink.items depends on ink.utils ^2.0.0
```

Resolution: error — no single version satisfies both ranges.
