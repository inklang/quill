# Target Version Ranges for Ink Packages

**Date:** 2026-03-28
**Status:** Approved

## Problem

Packages need to declare which versions of their target platform they support. A package targeting Paper might work on 1.20 through 1.22 but break on 1.23 due to API changes. Currently there is no way to express this — the only version signal is a single string in the legacy `[build].target-version` field with no range support.

## Design

### Manifest schema

Add `targetVersion` to `TargetConfig`:

```typescript
export interface TargetConfig {
  entry: string;
  jar?: string;
  jvmArgs?: string[];
  env?: Record<string, string>;
  targetVersion?: string;  // semver range, e.g. ">=1.20.0 <1.23.0"
}
```

Note: `BuildConfig` already has a `targetVersion` field (the legacy single-string version). This is intentionally the same name on a different interface — the new per-target field supersedes the legacy one.

TOML (kebab-case):

```toml
[targets.paper]
entry = "org.inklang.paper.PaperBridge"
jar = "runtime/paper/build/libs/ink-paper-0.2.0.jar"
target-version = ">=1.20.0 <1.23.0"

[targets.velocity]
entry = "com.example.VelocityBridge"
target-version = ">=3.3.0"
```

The field is optional. Omitting it means no version constraint — compatible with all versions of that target.

### Semver range implementation

The project has a custom `SemverRange` class in `src/model/semver.ts` that supports `^`, `~`, `*`, and exact match. For target-version ranges (which need comparator syntax like `>=1.20.0 <1.23.0`), add the `semver` npm package as a new dependency. The custom `SemverRange` class continues to be used for dependency version resolution. The `semver` package is only used for target-version range checking, keeping the two concerns separate.

Paper versions like `1.21.4` are valid semver strings — `semver.satisfies("1.21.4", ">=1.20.0 <1.23.0")` returns `true`. No coercion is needed.

Pre-release versions (e.g. `1.22.0-rc.1`) are out of scope for the initial implementation. The `semver` package handles them but Paper target-version ranges should use stable versions only.

### Legacy field handling

`[build].target-version` (single string, no range) is deprecated. The interaction rules:

- If both the legacy field and a per-target `target-version` exist for the **active** target: warn, prefer the per-target value.
- If the legacy field exists and a per-target `target-version` exists on a **non-active** target: the per-target value applies to its own target, the legacy field does not act as a fallback for other targets.
- The legacy field continues to parse for backward compatibility.
- The deprecation warning is emitted by `quill build` and `quill install` only.

### Build-time compatibility check

When `quill build` or `quill install` runs:

1. Resolve the active target — from `[build].target` or CLI `--target` flag.
2. Resolve the active target version — see resolution priority below.
3. For each dependency in `[dependencies]`, read its manifest from the local lockfile/install cache (not the registry). This ensures offline builds work.
4. Check each dependency's matching target — if it has a `target-version` range, verify the active target version satisfies it.
5. Error if incompatible. Warn if target-version is missing on the dependency side.

**Edge case — dependency has no matching target:** This is about the `target-version` check specifically. If a dependency has no target section matching the active target, the target-version compatibility check is skipped for that dependency. The existing install-time error ("could not find variant for target") is a separate concern and is unchanged.

**Edge case — invalid range syntax:** If a `target-version` field contains an unparseable string (e.g. `"bananas"`), error immediately with the package name and the invalid range value.

Example:

```
quill build --target paper --target-version 1.21.4

ink.mobs ^1.0.0 declares:
  [targets.paper]
  target-version = ">=1.20.0 <1.22.0"

1.21.4 satisfies >=1.20.0 <1.22.0 ✓

ink.newfeature ^2.0.0 declares:
  [targets.paper]
  target-version = ">=1.22.0"

1.21.4 does NOT satisfy >=1.22.0 ✗
Error: ink.newfeature ^2.0.0 requires paper >=1.22.0, but project targets 1.21.4
```

No runtime check — the Ink VM/plugin does not validate target versions. This is purely a quill concern.

`quill run` does not perform target-version compatibility checks. It has its own version resolution for selecting which server binary to download, which is a separate concern.

### Version resolution priority

When quill needs the target version for compatibility checks:

1. CLI flag (`--target-version 1.21.4`) — explicit override, highest priority.
2. `[build].target-version` in the project manifest — project-level default.
3. `[server].paper` — inferred from the configured server version (paper target only). The value is expected to be a plain semver string (major.minor.patch, e.g. `"1.21.4"`). Non-semver values cause a warning and fall through to step 4. For non-paper targets, this step is skipped entirely (no `[server].velocity` or equivalent exists — non-paper targets without `[build].target-version` or `--target-version` will always fall through to step 4).
4. No version specified — skip compatibility checks, emit a note that target-version checks are disabled.

Note: `quill run` has its own version resolution order (`server.paper ?? build.targetVersion ?? '1.21.4'`). The order above is for compatibility checks only and does not change `quill run`'s behavior.

This means a fresh project gets no errors (just a note), CI can pass `--target-version` for strict checks, and `[server].paper` serves as a convenient shorthand for Paper projects.

### CLI flag scope

The `--target-version` flag is accepted by:
- `quill build`
- `quill install`

Other commands (`quill run`, `quill publish`, `quill login`, etc.) do not accept this flag. `quill publish` runs `quill build` internally, so range validation happens as part of the build step — no separate validation is needed in publish.

### Parser changes

In `src/util/toml.ts`:

- Parse: add `targetVersion: cfg['target-version']` to the target config object in the targets section parsing loop.
- Serialize: add `...(cfg.targetVersion ? { 'target-version': cfg.targetVersion } : {})` to each target entry in the `write()` method's targets serialization.

No changes to `PackageManifest` top-level — only `TargetConfig` gains the field.

## Out of scope

- Runtime version validation at plugin load time.
- Automatic version detection from the running server.
- Per-script or per-grammar version constraints.
- Server-side registry enforcement of valid ranges (client-side validation only).
- Pre-release version handling in target-version ranges.
- Changing `quill run`'s version resolution or adding compatibility checks to `quill run`.
- Fixing the existing `SemverRange` tilde semantics (separate concern).
