# Changelog

## 0.3.2 — 2026-03-24

### Fixed

- `quill run` now passes stdin through to the Paper server so you can type commands into the console.

## 0.3.1 — 2026-03-24

### Fixed

- Bundle `compiler/ink.jar` in the npm package so `quill build` and `quill run` work after a global install without requiring `INK_COMPILER` env var.

## 0.3.0 — 2026-03-24

### Added

- `quill run` — managed Paper dev server command. Automatically downloads Paper and `Ink.jar` on first run, builds and deploys scripts, and watches for file changes to auto-rebuild and restart. Use `--no-watch` to start without file watching. Configure via `[server]` section in `ink-package.toml` (`paper`, `jar`, `path`).

## 0.2.2 — 2026-03-24

### Changed

- `add`, `remove`, `install`, `update`, `ls`, `clean`, `build`, `check`, `watch`, and `publish` now error immediately if run outside an Ink project directory (no `ink-package.toml` found)

## 0.2.1 — 2026-03-24

### Changed

- `quill --help` now groups commands by category (Project, Dependencies, Build, Registry)

## 0.2.0 — 2026-03-24

### Added

- `quill new <name>` now scaffolds a minimal **script project** instead of a grammar package. Creates `ink-package.toml` and `scripts/main.ink` only — no grammar TypeScript, no Kotlin runtime.
- Interactive template picker when running `quill new <name>` in a terminal: choose between `blank` (empty), `hello-world` (print statement), or `full` (function example).
- `--template=<name>` flag to skip the picker and scaffold directly (`blank`, `hello-world`, `full`).
- `--package` flag (`quill new <name> --package`) to scaffold a publishable grammar package with TypeScript grammar entry and Kotlin runtime — the previous default behavior.
- Shows your key fingerprint in the wizard if you are logged in via `quill login`.

### Changed

- `quill new <name>` default behavior changed from grammar package to script project. Use `--package` to get the old behavior.

## 0.1.3 — prior

- `quill login` / `quill logout` with Ed25519 keypair auth
- `quill update` command
- Auto-resolve bundled compiler, multi-grammar build support
