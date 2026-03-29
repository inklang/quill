# Package Type System Design

**Date:** 2026-03-28
**Status:** Approved

## Problem

Ink packages serve two fundamentally different purposes — libraries that extend the language and scripts that run on servers — but the registry and tooling treat them identically. Users browsing packages can't tell which is which, and there's no validation that a script package actually has an entry point.

## Solution

Add a first-class `type` field distinguishing `script` and `library` packages. The type is explicit in `ink-package.toml`, validated at publish time, stored as a constrained column in the database, and surfaced as a badge and filter on the Lectern website.

## Design

### ink-package.toml

A new field `type` under `[package]`:

```toml
[package]
name = "my-game-mode"
version = "1.0.0"
type = "script"    # "script" | "library"
description = "..."
author = "..."
license = "..."
main = "main"      # required when type = "script"
```

Rules:
- `type` is optional. If missing from ink-package.toml, quill defaults to `script` and does **not** warn (existing packages without the field should work without noise).
- When `type = "script"`, the `main` entry point must be present **on disk** — quill validates that the compiled output file exists (e.g. `dist/scripts/<main>.inkc`). Publish fails with an error if absent.
- When `type = "library"`, `main` is optional and ignored if present.

### TypeScript model changes

`PackageManifest` interface (in `src/model/manifest.ts`) gains:

```typescript
type?: 'script' | 'library'  // optional, defaults to 'script' at read time
main?: string                 // change from required to optional
```

`TomlParser.read` applies defaults:
- `type` defaults to `'script'` if absent from TOML.
- `main` defaults to `'main'` if absent and `type` is `'script'`. No default for `type = 'library'`.

`RegistryPackageVersion` (in `src/registry/client.ts`) gains `package_type: string`.

### Quill CLI

#### `quill new <name> --type=script|library`

- `<name>` is a required positional argument (matches existing interface).
- `--type` is optional, defaults to `script`.
- Creates directory structure and writes `ink-package.toml` with type pre-filled.
- Scaffolding differs by type:
  - **script**: creates `scripts/main.ink` with a hello-world starter, sets `main = "main"` in toml.
  - **library**: no `scripts/` directory created, no `main` field in toml.
- `--type` is independent of the existing `--package` flag. `--package` controls the scaffolding template (package vs project), `--type` controls the package type field. They can be combined freely.

#### `quill publish`

- Reads `type` from `ink-package.toml` (defaults to `script` if absent).
- If `type = "script"`, validates that `main` exists as a compiled file on disk. Exits with error if missing.
- Sends `package_type` as an HTTP header `X-Package-Type` in the publish request (consistent with existing `X-Package-Targets` header pattern).

### Registry / Database

Migration adds a `package_type` column to `package_versions`:

```sql
ALTER TABLE package_versions ADD COLUMN package_type text NOT NULL DEFAULT 'script';
ALTER TABLE package_versions ADD CONSTRAINT valid_package_type
  CHECK (package_type IN ('script', 'library'));
```

- `NOT NULL` with default `'script'` so existing rows migrate cleanly.
- Check constraint enforces only valid values.
- A package's displayed type is determined by its **latest version**. If versions disagree, the latest version wins. This matches how the search already deduplicates to the latest version per package.

#### Publish API

`PUT /api/packages/:name/:version` reads `X-Package-Type` header and stores it in the `package_type` column. If the header is absent, defaults to `'script'`.

The `PackageVersion` interface (in `src/lib/db.ts`) gains `package_type: string`.

#### Search API

`GET /api/search` gains optional `type` query parameter for filtering. Filtering is applied as a **pre-filter** in the Supabase queries (added to the WHERE clause of both FTS and vector search queries) so it doesn't waste retrieval budget.

The `SearchResult` type (in `src/lib/search.ts`) gains `package_type: string`.

#### Index API

`GET /index.json` includes `package_type` in each version entry so CLI consumers can filter locally.

### Lectern Website

#### Package detail page

- Small badge next to package name showing "Script" or "Library".
- Badge uses distinct colors (e.g. blue for script, purple for library) for at-a-glance distinction.

#### Search page

- Filter pills at top of results: `All | Scripts | Libraries`.
- Filtering happens without full page reload.
- Active filter reflected in URL query param for shareability (`/packages?type=script`).

#### Package cards (search results)

- Type badge appears on each card so users can scan the list.

## Future Considerations

- Additional types (e.g. `bridge`, `plugin`) can be added by extending the enum in both quill and the database check constraint.
- The type could eventually drive different install behaviors (e.g. `quill install` for libraries vs `quill deploy` for scripts).
