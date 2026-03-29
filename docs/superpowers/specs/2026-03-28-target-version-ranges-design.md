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

Uses standard semver range syntax via the `semver` npm package's `satisfies()`.

### Legacy field handling

`[build].target-version` (single string, no range) is deprecated. If both the legacy field and a per-target `target-version` exist for the active target, quill warns and prefers the per-target value. The legacy field continues to parse for backward compatibility.

### Build-time compatibility check

When `quill build` or `quill install` runs:

1. Resolve the active target — from `[build].target` or CLI `--target` flag.
2. Resolve the active target version — see resolution priority below.
3. For each dependency in `[dependencies]`, read its published manifest.
4. Check each dependency's matching target — if it has a `target-version` range, verify the active target version satisfies it.
5. Error if incompatible. Warn if target-version is missing on the dependency side.

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

### Version resolution priority

When quill needs the target version for compatibility checks:

1. CLI flag (`--target-version 1.21.4`) — explicit override, highest priority.
2. `[build].target-version` in the project manifest — project-level default.
3. `[server].paper` — inferred from the configured server version (paper target only).
4. No version specified — skip compatibility checks, warn that version checks are disabled.

This means a fresh project gets no errors (just a note), CI can pass `--target-version` for strict checks, and `[server].paper` serves as a convenient shorthand.

### Parser changes

In `src/util/toml.ts`:

- Parse: `targetVersion: cfg['target-version']` in the targets section.
- Serialize: `...(cfg.targetVersion ? { 'target-version': cfg.targetVersion } : {})` in `write()`.

No changes to `PackageManifest` top-level — only `TargetConfig` gains the field.

## Out of scope

- Runtime version validation at plugin load time.
- Automatic version detection from the running server.
- Per-script or per-grammar version constraints.
- Publishing enforcement (registry rejecting packages with invalid ranges).
