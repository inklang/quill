# Ink/Quill/Lectern Ecosystem - Migration Pain Points

Full review of what would frustrate someone trying to adopt this ecosystem, with prioritized action items.

---

## Critical

### 1. Language Maturity Gaps

~~Several features are parsed but not compiled, creating a "spec vs reality" gap:~~

- ~~**Try/catch/throw**~~ ✅ **FIXED** — compiler lowers to exception table entries; VM handles `THROW` + unwind.
- ~~**Closures**~~ ✅ **FIXED** — `LOAD_FUNC` populates upvalues from registers; `CALL` transfers them to new frame; `GET_UPVALUE` reads them.
- ~~**Imports**~~ ✅ **FIXED** — `import_resolver.rs` fully implemented: file resolution, circular import detection, caching, selective imports.
- ~~**58 failing tests**~~ ✅ **FIXED** — all ink VM tests passing (`BUILD SUCCESSFUL`).

~~A new user reads the language spec, writes idiomatic code using these features, and hits inscrutable failures.~~

**Remaining language gap:** Package exports (`src/exports.rs`) — plan exists but not yet implemented. Packages cannot declare their public API surface.

### 2. No Standalone Runner

Ink currently **only targets PaperMC/Minecraft servers**:

- The only runtime host is `ink-bukkit` (Paper plugin).
- All examples are Minecraft-specific (`on player_join`, `world.spawnEntity`).
- The stdlib globals (`server`, `player`, `world`) are Bukkit-injected, not portable.
- There is no `ink run script.ink` without a Minecraft server.

Anyone evaluating Ink for non-Minecraft scripting (or even just learning the language) hits a dead end. A standalone CLI runner would let people experiment without the full Paper stack.

---

## High

### 3. Error Diagnostics Are Minimal

- **Printing Press stops at the first error** with no recovery. One typo = one error, fix, recompile, repeat.
- **No source maps or line references** in runtime errors - when bytecode throws, you get a VM-level error with no trace back to `.ink` source lines.
- **No LSP** yet (design spec exists but unimplemented) - no IDE integration, no autocomplete, no inline errors.

Compare to any modern scripting language where `go to definition`, red squiggles, and multi-error reporting are table stakes.

### 4. No Self-Hosting Documentation for Lectern

Lectern has zero setup docs for self-hosting. You'd need to:

1. Create a Supabase project manually
2. Run 20 SQL migrations in order
3. Configure GitHub OAuth provider in Supabase dashboard
4. Create storage buckets with correct permissions
5. Sign up for NVIDIA NIM API (or lose semantic search)
6. Set 5+ environment variables correctly
7. Deploy to Vercel (or figure out Node SSR yourself)

No Docker image, no `docker-compose.yml`, no one-click deploy.

### 5. Empty Package Ecosystem (Cold Start)

- No packages published (or very few) - `quill search` returns nothing useful.
- No community - no Discord, no forums, no Stack Overflow tag.
- No standard library packages to bootstrap from.
- The `index.json` approach (fetch entire index) won't scale, but isn't a problem yet because there's nothing to fetch.

---

## Medium

### 6. Configuration Complexity

`ink-package.toml` has a deep surface area for a young ecosystem:

- `[package]`, `[dependencies]`, `[grammar]`, `[build]`, `[server]`, `[targets.<name>]`, `[runtime]` (deprecated)
- Multi-target support, target-version ranges, per-target JVM args and env vars
- Legacy `[runtime]` still supported alongside `[targets]` - two ways to configure the same thing
- Grammar entry points, IR output paths, compiler paths

A new user creating their first project shouldn't need to understand targets, grammars, and runtime configurations.

### 7. Build Pipeline Complexity

`quill build` does an enormous amount:

1. Parse TOML manifest
2. Resolve target + target-version from 3+ fallback sources
3. Validate dependency compatibility
4. Compile TypeScript grammar to IR (if grammar exists)
5. Run Gradle build for runtime JARs (if runtime exists)
6. Copy package artifacts
7. Compile `.ink` to `.inkc` via external Rust binary
8. Incremental caching with hash-based dirty checking
9. Generate `ink-manifest.json`
10. Auto-deploy to Paper server

When any step fails, the error context is often just "Gradle build failed" or "compiler returned non-zero". Debugging requires understanding the full pipeline.

### 8. Auth Flow Is Novel But Fragile

The Ed25519 asymmetric auth (`Ink-v1 keyId=...,ts=...,sig=...`) is creative but:

- No ecosystem uses this pattern - no reference implementations or middleware libraries.
- 5-minute replay window requires synchronized clocks.
- Key registration requires an active browser session - can't set up CI/CD without manual browser auth first.
- If `~/.quillrc` is lost, there's no key recovery - must re-auth from scratch.

### 9. Testing Story Is Incomplete

- `quill test` exists but the Ink-side test framework is minimal.
- No assertion library in the Ink stdlib.
- No test runner output format (TAP, JUnit XML) for CI integration.

### 10. LSP / IDE Support

Design spec and implementation plan exist (`docs/superpowers/specs/2026-03-28-ink-lsp-design.md`) but nothing is implemented. No syntax highlighting package, no editor plugin, no language server.

---

## Low

### 11. Heavy Infrastructure Requirements

The full ecosystem requires four different language runtimes:

| Component | Requires |
|-----------|----------|
| Ink compiler | Rust binary (printing_press) |
| Ink runtime | JVM 21 + Kotlin + Paper server |
| Quill CLI | Node.js + npm |
| Lectern registry | Supabase + NVIDIA NIM + Vercel/Node |
| Development | Gradle + JDK 21 + Rust toolchain + Node 22+ |

High barrier to contribute compared to single-runtime ecosystems.

### 12. Consolidate Tech Stack

Three languages across three repos (Rust, Kotlin, TypeScript) means contributors need breadth across all three to understand the full picture.

---

## Recommended Action Plan

| Priority | Action | Status | Repo |
|----------|--------|--------|------|
| ~~**Critical**~~ | ~~Finish closures, try/catch, and imports~~ | ✅ Done | ink / quill |
| **Critical** | Implement package exports (`src/exports.rs`) | ❌ Plan written, not built | quill |
| **Critical** | Add a standalone `ink run` command (no Minecraft required) | ❌ Open | ink |
| **High** | Multi-error reporting + source-location in runtime errors | ❌ Open | quill / ink |
| **High** | Docker-compose for self-hosted Lectern | ❌ Open | lectern |
| **High** | Seed registry with starter packages (stdlib utilities, common patterns) | ❌ Open | lectern / quill |
| **Medium** | Implement LSP for IDE support | ❌ Spec + plan written, not built | new repo |
| **Medium** | Simplify `ink-package.toml` defaults (hide targets/grammar for simple scripts) | ❌ Open | quill |
| **Medium** | CI-friendly auth (service accounts or deploy tokens) | ❌ Open | lectern / quill |
| **Medium** | Add assertion stdlib + test output formats | ❌ Open | ink |
| **Low** | Consolidate or document the multi-runtime contribution path | ❌ Open | all |
