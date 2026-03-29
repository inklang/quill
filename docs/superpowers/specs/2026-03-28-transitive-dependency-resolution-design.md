# Transitive Dependency Resolution

**Date:** 2026-03-28

## Summary

Make `quill add` and `quill install` resolve and install transitive dependencies automatically. `add` installs a single package + its full dep tree. `install` restores the full tree from `ink-package.toml` (fresh checkout workflow). The lock file tracks the dependency graph so `remove` can clean up orphaned transitives.

## Motivation

Currently `quill add` and `quill install` only install direct dependencies. If package A depends on package B, running `quill add A` does not install B. Neither command resolves the full dependency tree.

## Design

### Resolution Algorithm

Shared by both `add` and `install`:

1. Start with a set of root dependencies (`add`: single package; `install`: all deps from `ink-package.toml`)
2. Resolve each via `findBestMatch`
3. Read the resolved package's `dependencies` from the registry index (`RegistryPackageVersion.dependencies`)
4. For each dependency, resolve via `findBestMatch`
   - If the package is already in the resolved set, verify the resolved version satisfies the new range
   - If not, re-resolve to find a version satisfying **all** accumulated ranges
   - If no single version satisfies all ranges, error with a clear message showing the conflicting requirements
5. Recurse into each newly resolved package's dependencies
6. Track a visited set to prevent cycles

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

- **`ink-package.toml`** — only direct packages are listed in `dependencies` (unchanged)
- **`quill.lock`** — updated to track the dependency graph:

```json
{
  "version": 2,
  "registry": "https://lectern.inklang.org",
  "packages": {
    "ink.mobs@1.2.0": {
      "version": "1.2.0",
      "resolutionSource": "https://...",
      "dependencies": ["ink.utils@1.5.0"]
    },
    "ink.utils@1.5.0": {
      "version": "1.5.0",
      "resolutionSource": "https://...",
      "dependencies": []
    }
  }
}
```

Each lock entry gains a `dependencies` array listing its direct transitive deps (as `name@version` strings). This allows `remove` to walk the graph and detect orphaned transitives.

Existing lock entries are preserved; only new/changed entries are added. Compatible locked versions are kept as-is.

### `quill add <pkg>`

- Resolves the direct package + full transitive tree
- Downloads and installs all new packages in the tree
- Adds only the direct package to `ink-package.toml` dependencies
- Writes the full resolved tree to `quill.lock`

### `quill install`

- Reads `ink-package.toml` dependencies
- For each, checks lock file first — if locked version exists and is compatible, uses it
- Resolves the full transitive tree for all dependencies
- Downloads and installs anything missing from `packages/`
- Rewrites `quill.lock` with the complete resolved tree

This is the fresh-checkout restore command.

### `quill remove <pkg>` (future)

With graph info in the lock file, `remove` can:
1. Remove the package from `ink-package.toml`
2. Walk the lock file graph to find transitive deps only used by the removed package
3. Remove those orphaned transitives from `packages/` and the lock file

Not in scope for this change — but the lock file format enables it.

## Scope

- Changes: `src/commands/add.ts`, `src/commands/install.ts`, `src/lockfile.ts`, `src/cli.ts`
- No changes to: registry client, toml parser

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
