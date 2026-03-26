# Runtime Environments: Multi-Target Build Support

## Context

Quill currently assumes all runtimes are JVM/JAR. This design introduces target-specific runtime variants so that packages and projects can target different VMs (e.g., Paper/JVM, WASM, Node.js).

## Goals

- Single target per project (one `ink-package.toml`, one `target` field)
- Packages can ship multiple runtime variants in target-specific subfolders
- Quill resolves the correct variant at install and build time based on project target
- Grammar compilation remains target-agnostic
- Quill has built-in knowledge of known targets (e.g., "paper" = JVM)

---

## Project Target

### ink-package.toml

```toml
[package]
name = "my-plugin"
version = "1.0.0"
target = "paper"
```

- `target` is a freeform string — no formal registry of valid targets
- Quill ships with built-in knowledge for common targets (see Known Targets section)
- Target is set once per project; changing it requires updating `ink-package.toml`

---

## Package Registry Variants

### Registry Storage Structure

Packages in the registry store target-specific artifacts in subfolders:

```
ink.mobs/
├── paper/
│   ├── ink-manifest.json   # target-specific manifest
│   ├── grammar.ir.json
│   └── mobs-runtime.jar
└── wasm/
    ├── ink-manifest.json
    ├── grammar.ir.json
    └── runtime.wasm
```

### Package Index Metadata

Registry index entries include a `targets` field:

```json
{
  "name": "ink.mobs",
  "version": "1.0.0",
  "description": "Mob grammar and runtime",
  "targets": ["paper", "wasm"]
}
```

### ink-manifest.json (per target variant)

Each variant has its own `ink-manifest.json` with target-specific runtime info:

```json
{
  "name": "ink.mobs",
  "version": "1.0.0",
  "target": "paper",
  "grammar": "grammar.ir.json",
  "runtime": {
    "jar": "mobs-runtime.jar",
    "entry": "org.ink.mobs.MobsRuntime"
  },
  "scripts": ["main.inkc"]
}
```

---

## Install Behavior

### quill add

```
quill add ink.mobs
```

1. Fetch package index from registry
2. Read `targets` field from index entry
3. Compare against project's `target` in `ink-package.toml`
4. Download and install only the matching variant to `packages/ink.mobs/`

### quill install

```
quill install
```

Same resolution: installs each package's variant matching project target.

---

## Build Behavior

### quill build

```
quill build
```

1. Read `target` from project's `ink-package.toml`
2. For each dependency in `packages/<name>/`:
   - Read `packages/<name>/ink-manifest.json`
   - Verify manifest's `target` matches project target
   - Copy runtime artifacts (JAR, WASM, etc.) to `dist/`
3. Grammar and script compilation remain unchanged — they are target-agnostic

---

## Known Targets

Quill ships with built-in knowledge for these targets:

| Target   | Host Language | Build Tool | Expected Paths                          |
|----------|---------------|------------|-----------------------------------------|
| `paper`  | Kotlin/JVM    | Gradle     | `runtime/build/libs/*.jar`              |

### Future Targets (not implemented)

| Target | Host Language | Build Tool |
|--------|---------------|------------|
| `wasm` | Rust/JS       | Cargo/npm  | `runtime/dist/*.wasm`                   |
| `node` | JavaScript    | npm        | `runtime/dist/*.js`                      |

---

## Dependency Graph

```
Project (target = "paper")
  └── ink.mobs (variant: paper)
        └── grammar.ir.json
        └── mobs-runtime.jar
  └── ink.core (variant: paper)
        └── grammar.ir.json
        └── core-runtime.jar
```

---

## Error Handling

### Missing Variant

If a project targets `paper` but `ink.mobs` does not ship a `paper` variant:

```
Error: Package ink.mobs@1.0.0 does not support target "paper".
       Available targets: wasm, node
```

### Target Mismatch on Build

If an installed package's `ink-manifest.json` has a different `target` than the project:

```
Error: Package ink.mobs is installed for target "wasm" but project targets "paper".
       Run quill reinstall to resolve.
```

---

## Test Plan

1. Create fixture project with `target = "paper"` and a dependency that has multiple variants
2. `quill add` installs correct variant only
3. `quill build` copies correct runtime artifacts to dist
4. Build fails with clear error if no matching variant exists
5. Build fails with clear error if installed variant doesn't match project target
