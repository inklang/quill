# Multi-Target Runtime Architecture — Design

**Date:** 2026-03-25
**Status:** Approved

---

## Problem

The current Quill package structure assumes a single runtime target. Packages are built for one VM (JVM/Kotlin for Paper) with no support for multiple targets or per-target runtime code.

This limits Ink packages to a single execution environment and makes it impossible for a single package to support Paper, Hytale, or other targets simultaneously.

---

## Design

### Directory Structure

```
my-package/
├── ink-package.toml              # declares targets, grammar, entry
├── src/
│   └── grammar.ts                # shared grammar IR
├── scripts/
│   └── main.ink                  # shared scripts
└── runtime/
    ├── paper/
    │   ├── build.gradle.kts      # or target-specific build config
    │   └── src/main/
    │       ├── kotlin/
    │       │   └── PaperRuntime.kt   # VM + builtin ops
    │       └── ink/
    │           └── ops.ink            # custom Ink ops (optional)
    └── hytale/
          └── ...
```

**Key insight:** The VM implementation is per-target and language-agnostic in structure. Paper uses Kotlin, but Hytale could use any language — the structure is the same.

### `ink-package.toml` Schema

```toml
name = "my-package"
version = "0.1.0"
main = "mod"

[targets]
paper = { entry = "MyPackagePaperRuntime" }
hytale = { entry = "MyPackageHytaleRuntime" }

[grammar]
entry = "src/grammar.ts"

[dependencies]
```

### Build Commands

```bash
quill new my-package --target=paper,hytale  # scaffold with multi-target structure
quill build --target=paper                  # produces my-package-paper-0.1.0.jar
quill build --target=hytale                 # produces my-package-hytale-0.1.0.jar
quill build --target=all                    # builds all declared targets
```

### Op Injection Model

Ops are **host functions** registered at runtime. Two sources:

1. **Builtin ops** — core language ops (`print`, `+`, etc.) are registered in Kotlin/host code inside the target runtime
2. **Custom ops** — defined in `runtime/<target>/src/main/ink/ops.ink`, transpiled to Kotlin at build time

**Flow:**
```
Ink code (WHAT)        VM dispatch         Host code (HOW)
     │                                       │
     ▼                                       ▼
print("hello")  ──►  VM looks up "print"  ──►  runtime.registerOp("print", ...)
```

**Dynamic dispatch (no manifest):** VM just dispatches. Op not registered? Runtime error. Developer is responsible for registering all ops their package uses.

**Custom ops.ink compilation:** `runtime/<target>/src/main/ink/ops.ink` is transpiled to Kotlin at build time, then compiled with the target's Gradle build. No runtime interpreter — just normal JVM dispatch.

### Build Validation

```bash
quill build --target=paper   # OK if "paper" is in targets list
quill build --target=hytale  # FAILS if "hytale" not declared
```

If a package does not declare support for the target, `quill build --target=X` fails with a clear error. No partial builds.

### What's Universal vs Per-Target

| Component | Scope |
|-----------|-------|
| `ink-package.toml` | Universal (declares targets) |
| `src/grammar.ts` | Universal (compiles to IR) |
| `scripts/*.ink` | Universal |
| `runtime/<target>/src/main/kotlin/*` | Per-target (VM implementation) |
| `runtime/<target>/src/main/ink/ops.ink` | Per-target (custom ops) |
| Build output (`*.jar`) | Per-target |

---

## Implementation Checklist

- [ ] Add `--target` flag to `NewCommand` (comma-separated list)
- [ ] Update `ink-package.toml` schema to support `targets` map
- [ ] Update `PackageManifest` type to support multi-target
- [ ] Scaffold per-target runtime folders with build config + VM stub
- [ ] Add `--target` flag to `BuildCommand`
- [ ] Update `InkBuildCommand` to build per-target JAR
- [ ] Define `InkRuntime` host API interface for registering ops
- [ ] Document VM interface contract (how ops are registered, how IR is loaded)

---

## Open Questions

~~How does the VM know which ops are available?~~ — **Resolved:** Dynamic dispatch, no manifest. Runtime error if op not registered.

~~How are Ink-defined ops (`ops.ink`) compiled and loaded?~~ — **Resolved:** Transpiled to Kotlin at build time, compiled with Gradle. No runtime interpreter.

- What is the `InkRuntime` interface contract that all target VMs must implement?
