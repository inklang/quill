# Changelog

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
