# Package Type System Design

**Date:** 2026-03-28
**Status:** Approved

## Problem

Ink packages serve two fundamentally different purposes — libraries that extend the language and scripts that run on servers — but the registry and tooling treat them identically. Users browsing packages can't tell which is which, and there's no validation that a script package actually has an entry point.

## Solution

Add a first-class `type` field distinguishing `script` and `library` packages. The type is explicit in `ink-package.toml`, validated at publish time, stored as a constrained column in the database, and surfaced as a badge and filter on the Lectern website.

## Design

### ink-package.toml

A new required field `type` under `[package]`:

```toml
[package]
name = "my-game-mode"
version = "1.0.0"
type = "script"    # "script" | "library"
description = "..."
author = "..."
license = "..."
main = "mod"       # required when type = "script"
```

Rules:
- `type` is required for publish. If missing, quill warns and defaults to `script`.
- When `type = "script"`, `main` must be present. Publish fails with an error if absent.
- When `type = "library"`, `main` is optional.

### Quill CLI

#### `quill new [path] --type=script|library`

- `path` is optional, defaults to current directory.
- `--type` is optional, defaults to `script`.
- Creates directory structure and writes `ink-package.toml` with type pre-filled.
- Scaffolding differs by type:
  - **script**: creates `scripts/main.ink` with a hello-world starter, sets `main = "mod"` in toml.
  - **library**: creates empty `scripts/` directory, omits `main` field.

#### `quill publish`

- Reads `type` from `ink-package.toml`.
- If `type = "script"`, validates that `main` exists. Exits with error if missing.
- Sends `package_type` as part of the publish payload to the registry.

### Registry / Database

Migration adds a `package_type` column to `package_versions`:

```sql
ALTER TABLE package_versions ADD COLUMN package_type text NOT NULL DEFAULT 'script';
ALTER TABLE package_versions ADD CONSTRAINT valid_package_type
  CHECK (package_type IN ('script', 'library'));
```

- `NOT NULL` with default `'script'` so existing rows migrate cleanly.
- Check constraint enforces only valid values.
- Publish API (`PUT /api/packages/:name/:version`) accepts `package_type` in form data and stores it.
- Search API (`GET /api/search`) gains optional `type` query parameter for filtering.

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
