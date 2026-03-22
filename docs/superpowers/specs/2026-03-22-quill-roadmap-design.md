# Quill Implementation Roadmap

## Context

Quill is the build system for Ink, a Minecraft Paper scripting language with a plugin-extensible grammar system. Quill is a TypeScript/npm CLI tool (`@inklang/quill`).

### What's already built

- `ink-package.toml` manifest with `[package]`, `[dependencies]`, `[grammar]`, `[runtime]` sections
- Package management: `add`, `remove`, `install`, `ls`, `clean`, `init`, `new`
- `quill build` — validates/copies runtime JAR, writes `dist/ink-manifest.json`, compiles grammar
- `quill check` — validates grammar and runtime JAR existence
- Grammar IR types, authoring API, serializer, validator — all implemented and tested
- 24+ passing tests

### Key design decisions

- `quill new` is the only scaffold command — creates a full package (grammar + runtime + Gradle). Grammar-only packages are achieved by omitting the `[runtime]` section. `quill ink-new` is removed.
- Default scaffold includes `runtime/build.gradle.kts` managed by Quill.
- `quill build` runs Gradle inside `runtime/` if `runtime/build.gradle.kts` exists, then copies the output JAR to `dist/`.
- Package authors can bypass Gradle by pointing `[runtime] jar` at an external prebuilt JAR path.
- Ink packages are distributed through a Quill registry (like npm), not as Paper JARs.
- Grammar IR is the contract between Quill output and the JVM runtime.
- `.ink` to `.inkc` bytecode compilation is a subprocess call — the compiler lives on the JVM side, Quill invokes it.

### System context

```
ink-package.toml          <- project manifest
src/
  grammar.ts              <- grammar definition (defineGrammar API)
scripts/
  *.ink                   <- Ink scripts
runtime/
  build.gradle.kts        <- Gradle project Quill manages
  src/main/kotlin/
    MyPackageRuntime.kt   <- InkRuntimePackage implementation
      |
quill build
      |
dist/
  ink-manifest.json       <- JVM entry point
  grammar.ir.json         <- compiled grammar
  scripts/*.inkc           <- compiled bytecode
  runtime.jar             <- built by Gradle, copied here
```

## Roadmap ordering rationale

**Compilation-first (Approach A):** Build the complete local development loop before distribution. A package author can write grammar + scripts, build everything locally, and see compiled output before publishing. Registry is more complex (server-side concerns, auth, tarball packing) and benefits from having a fully-formed build to test against.

Order: Cleanup -> Scaffold -> Build/Gradle -> Compilation -> Registry -> Watch -> ink.core slot

---

## Chunk 1: Remove `quill ink-new` and Clean Up

**What it builds:** Eliminates the redundant `ink-new` command. After this, `quill new` is the only way to scaffold a project.

**Files modified:**
- `src/cli.ts` — remove `ink-new` command registration
- Delete `src/commands/ink-new.ts`
- Delete any ink-new tests

**Acceptance criteria:**
- `quill ink-new` is not a recognized command
- All existing tests pass (minus ink-new tests)
- No imports or references to ink-new remain in the codebase

**Unblocks:** Chunk 2 — clears the way to make `quill new` the single authoritative scaffold

---

## Chunk 2: `quill new` Full Scaffold (Grammar + Runtime + Gradle)

**What it builds:** Upgrades `quill new <name>` from its current minimal scaffold (toml + mod.ink) to a complete package with grammar definition, runtime Kotlin stub, Gradle build file, and starter script.

**Files modified:**
- `src/commands/new.ts` — rewrite scaffold logic to generate full structure
- Tests for `quill new` — verify the complete output structure

**Scaffolded output for `quill new ink.mobs`:**
```
ink.mobs/
  ink-package.toml          # [package] + [dependencies] + [grammar] + [runtime]
  src/
    grammar.ts              # Starter grammar (defineGrammar with placeholder declaration)
  scripts/
    main.ink                # Starter .ink script
  runtime/
    build.gradle.kts        # Kotlin/JVM Gradle project, depends on ink-runtime API
    src/main/kotlin/
      InkMobsRuntime.kt    # Stub InkRuntimePackage implementation
```

**Acceptance criteria:**
- `quill new ink.mobs` creates the full directory tree above
- `ink-package.toml` has all four sections (`[package]`, `[dependencies]`, `[grammar]`, `[runtime]`)
- `grammar.ts` imports from `@inklang/quill/grammar` and exports a valid `defineGrammar` call
- `build.gradle.kts` is a valid Kotlin/JVM Gradle project
- Runtime Kotlin file is a compilable stub
- `quill check` passes on the scaffolded project (grammar validates)
- Package name is properly converted for Kotlin class names and Gradle artifact names

**Unblocks:** Chunk 3 — there's now a `runtime/build.gradle.kts` to orchestrate

---

## Chunk 3: `quill build` Gradle Orchestration

**What it builds:** When `runtime/build.gradle.kts` exists, `quill build` runs Gradle inside `runtime/`, then copies the output JAR to `dist/`. If no `runtime/` directory exists, build skips the Gradle step. If `[runtime] jar` points to an external prebuilt JAR path, skip Gradle and copy that JAR directly.

**Files modified:**
- `src/commands/ink-build.ts` — add Gradle subprocess execution, JAR discovery, error handling
- Tests — new test cases for Gradle orchestration (mock/stub the subprocess)

**Behavior:**
1. Check if `runtime/build.gradle.kts` exists
2. Check for `runtime/gradlew` (or `runtime/gradlew.bat` on Windows) — use wrapper if present, fall back to system `gradle` if not
3. Spawn Gradle build in `runtime/`
4. Wait for exit. On failure: print Gradle output, exit with code 1
5. Find output JAR in `runtime/build/libs/` (error if missing or ambiguous)
6. Copy JAR to `dist/`, update `ink-manifest.json` with JAR filename and entry class
7. If no `runtime/` but `[runtime] jar` is set to an external path: copy that JAR (existing behavior)
8. If neither: skip runtime, grammar-only build

**Acceptance criteria:**
- `quill build` in a scaffolded project runs Gradle and produces `dist/runtime.jar`
- Gradle wrapper (`gradlew`/`gradlew.bat`) is preferred over system `gradle` when present
- Falls back to system `gradle` when no wrapper exists
- Gradle failure produces a clear error message with Gradle's output
- `dist/ink-manifest.json` correctly references the built JAR and entry class
- External JAR path (`[runtime] jar = "/some/prebuilt.jar"`) still works
- Grammar-only packages (no `runtime/` dir, no `[runtime]` section) build without errors
- Tests cover: Gradle success, Gradle failure, wrapper detection, external JAR, no runtime

**Unblocks:** Chunk 4 — build now produces a complete package, the JVM runtime is available to invoke for `.ink` compilation

---

## Chunk 4: `.ink` to `.inkc` Compilation Integration

**What it builds:** Wires up `.ink` script compilation into `quill build`. The compiler lives on the JVM side — Quill invokes it as a subprocess, passing source files and the compiled grammar IR, and collects `.inkc` bytecode output into `dist/scripts/`.

**Files modified:**
- `src/commands/ink-build.ts` — add compilation step after grammar + runtime build
- New utility or inline logic for subprocess invocation of the JVM compiler
- Tests — compilation step (mock subprocess)

**Behavior:**
1. After grammar IR and runtime JAR are in `dist/`, scan `scripts/` for `*.ink` files
2. Invoke the JVM compiler as a subprocess: pass it the grammar IR path, the list of `.ink` source files, and an output directory (`dist/scripts/`)
3. The compiler produces one `.inkc` file per `.ink` source file
4. On compiler failure: print compiler output, exit with code 1
5. If no `scripts/` directory or no `.ink` files: skip silently
6. Update `dist/ink-manifest.json` with a `scripts` field listing compiled files

**Acceptance criteria:**
- `quill build` compiles `scripts/*.ink` to `dist/scripts/*.inkc`
- Compiler errors produce clear output with source file and error details
- Missing `scripts/` directory is not an error
- `ink-manifest.json` lists compiled script files
- The subprocess invocation is stubbed/mockable for tests
- Works even if only grammar exists (no runtime) — compiler uses grammar IR only

**Unblocks:** Chunk 5 — packages now produce complete artifacts (grammar IR + runtime JAR + compiled scripts) ready for distribution

---

## Chunk 5: Registry — Publishing and Consuming

**What it builds:** Two capabilities: `quill publish` to push a built package to the registry, and upgrading `quill add`/`quill install` to pull real packages.

**Files modified:**
- New `src/commands/publish.ts` — `quill publish` command
- `src/cli.ts` — register publish command
- `src/registry/client.ts` — add publish endpoint, auth token handling
- `src/commands/add.ts` / `src/commands/install.ts` — verify/fix real package consumption flow
- `src/util/fs.ts` — add tarball packing (complement to existing `extractTarGz`)
- Tests — publish flow, tarball packing, end-to-end add/install with mock registry

**`quill publish` behavior:**
1. Run `quill build` first (ensure `dist/` is fresh)
2. Validate `ink-package.toml` has required fields (name, version, description)
3. Pack project into tarball: `ink-package.toml`, `dist/` contents (grammar IR, runtime JAR, compiled scripts)
4. Read auth token from `~/.quillrc` or `QUILL_TOKEN` env var
5. PUT/POST tarball to `{registry}/packages/{name}/{version}`
6. Print success with package name and version

**`quill add` / `quill install` verification:**
1. Confirm downloaded packages extract correctly and their `ink-package.toml` is readable
2. Confirm dependency resolution works with real semver ranges
3. Confirm `quill.lock` is written correctly after install

**Acceptance criteria:**
- `quill publish` packs and uploads a package to the registry
- Auth token is read from `~/.quillrc` or `QUILL_TOKEN`
- Missing auth produces a clear error ("run `quill login` or set QUILL_TOKEN")
- `quill add some-pkg` downloads, extracts, and installs a real package
- `quill install` resolves all dependencies and writes lockfile
- Republishing the same version is rejected by the registry (409 or similar)
- Tests cover: pack, upload success, upload auth failure, download + extract

**Unblocks:** Chunk 6 — with publish/consume working, the full authoring loop is closed

---

## Chunk 6: `quill watch` — Rebuild on File Change

**What it builds:** A file watcher that re-runs `quill build` when source files change.

**Files modified:**
- New `src/commands/watch.ts` — `quill watch` command
- `src/cli.ts` — register watch command
- `package.json` — add `chokidar` dependency (or use `fs.watch` with debouncing)
- Tests — watcher triggers build on file change

**Behavior:**
1. Read `ink-package.toml` to determine which directories exist
2. Watch relevant directories:
   - `src/` (grammar changes)
   - `scripts/` (ink script changes)
   - `runtime/src/` (Kotlin source changes, if `runtime/` exists)
3. On change: debounce (300ms), then run `quill build`
4. Print what changed and build result (success/failure)
5. On build failure: print errors, keep watching (don't exit)
6. Ctrl+C to stop

**Acceptance criteria:**
- `quill watch` starts and prints watched directories
- Editing `src/grammar.ts` triggers a rebuild
- Editing `scripts/*.ink` triggers a rebuild
- Editing `runtime/src/**/*.kt` triggers a rebuild (if runtime exists)
- Rapid successive changes are debounced into a single build
- Build errors are printed but the watcher keeps running
- Clean exit on Ctrl+C

**Unblocks:** Nothing directly — completes the local development loop as a DX improvement

---

## Chunk 7: `ink.core` Base Grammar Package — Slot

**What it builds:** A placeholder/slot for the `ink.core` base grammar package. Deferred until the Ink language spec is ready.

**Files created (when language spec is ready):**
- New directory `packages/ink.core/` (or a separate repo)
- `ink-package.toml` — the ink.core manifest
- `src/grammar.ts` — base grammar defining core Ink constructs (variables, control flow, expressions)
- No runtime — ink.core's runtime is built into the Ink engine itself

**What ink.core will define:**
- Core declaration types (the base that `inheritsBase: true` extends)
- Core expression grammar (literals, operators, function calls)
- Core statement grammar (if/else, loops, variable binding)
- Core type grammar (if Ink has types)

**Acceptance criteria (for the slot, not the implementation):**
- Other packages can declare `"ink.core" = ">=1.0.0"` in `[dependencies]`
- `inheritsBase: true` in grammar declarations refers to ink.core's base rules
- `checkKeywordConflicts()` in the validator can cross-check against ink.core's keywords
- The registry can host ink.core as a normal package

**Unblocks:** Language spec work — once the spec is defined, ink.core is the first package built and published, and all other packages depend on it
