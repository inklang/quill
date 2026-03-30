# Package Exports Design

Date: 2026-03-29

## Problem

Packages have no way to declare what classes, functions, and grammars they provide. Consumers can't discover what's available in a dependency without reading source code. There's no compile-time validation that imports resolve to real exports.

## Solution

A compiler-generated `exports.json` sub-manifest that lists all classes (with their methods), functions, and grammar contributions a package provides. The compiler infers exports from source code. Everything is public by default; `@internal` marks items restricted to same-author packages.

## Source-Level Annotations

### `@internal`

Marks a top-level class or function as internal. Internal items are only accessible to packages by the same author.

```ink
class Wallet:
  fn get_balance() -> int:
    return self.balance

  fn deposit(amount: int) -> void:
    self.balance = self.balance + amount

  @internal
  fn audit_log() -> void:
    // same-author only
```

No `@public` or `@export` annotation is needed. Unannotated items are public by default.

### Scope of `@internal`

- On a **class**: the class itself is internal. When a class is internal, all its methods are implicitly internal regardless of individual annotations. The class's `methods` array lists all methods (no separate `internal_methods` — the class gate already restricts access).
- On a **method** within a public class: only that method is internal, listed under `internal_methods`.
- On a **function**: the function is internal.

## Compiler-Generated `exports.json`

`quill build` produces `exports.json` in the project root (not inside `target/`). This ensures it's picked up by the publish tarball walker, which excludes `target/`.

### Format

```json
{
  "version": 1,
  "classes": {
    "Wallet": {
      "visibility": "public",
      "methods": ["get_balance", "deposit", "transfer"],
      "internal_methods": ["audit_log"]
    },
    "Ledger": {
      "visibility": "internal",
      "methods": ["reconcile"]
    }
  },
  "functions": {
    "format_currency": "public",
    "parse_amount": "internal"
  },
  "grammars": ["economy"]
}
```

The top-level `version` field enables future format evolution. Consumers check this field before parsing.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `u32` | Format version, currently `1` |
| `classes` | `Map<String, ClassExport>` | Exported classes with visibility and method lists |
| `functions` | `Map<String, Visibility>` | Top-level functions with visibility |
| `grammars` | `Vec<String>` | Grammar namespace identifiers contributed by this package |

**ClassExport (public class):**

| Field | Type | Description |
|-------|------|-------------|
| `visibility` | `"public"` or `"internal"` | Whether the class is public or internal |
| `methods` | `Vec<String>` | Public method names |
| `internal_methods` | `Vec<String>` | Internal method names (only meaningful on public classes) |

**ClassExport (internal class):**

| Field | Type | Description |
|-------|------|-------------|
| `visibility` | `"internal"` | The class is internal |
| `methods` | `Vec<String>` | All method names (no `internal_methods` key — the class gate already restricts access) |

### Grammar Detection

The `grammars` array lists grammar package namespace identifiers — the `package` field from the project's `GrammarPackage` (e.g., a grammar file declaring `package ink.paper` produces the identifier `"ink.paper"`). This is distinct from individual `GrammarDecl` names (like `PaperPlugin`), which are declarations within a grammar package. When a package has no grammar files, the array is empty.

## Author Matching for `@internal`

Visibility checks compare the importing package's author against the exporting package's author. Authorship is determined by:

1. The registry username associated with the published package (from the auth token used during `quill publish`).
2. Fallback: the `package.author` field in `quill.toml`.

**When author is missing**: If the exporting package has no author (no registry username and no `package.author`), all `@internal` items are treated as public. If the importing package has no author, it fails the same-author check and cannot access internal items.

**Rule**: `@internal` is a best-effort namespace convention, not a security boundary. It prevents accidental misuse across different authors, not adversarial access.

## Publishing Flow

`quill publish` includes `exports.json` from the project root in the published tarball. The registry indexes export data so that:

- `quill search` can show what a package provides (classes, functions, grammars)
- `quill info <package>` displays the full API surface
- Consumers can inspect available exports before installing

### Registry Index Entry

The `RegistryPackageVersion` struct gains an optional `exports` field:

```rust
pub struct RegistryPackageVersion {
    pub version: String,
    pub url: String,
    pub dependencies: BTreeMap<String, String>,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub targets: Option<Vec<String>>,
    pub checksum: Option<String>,
    pub package_type: String,
    // New field:
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exports: Option<PackageExports>,
}
```

The `PackageExports` struct mirrors the `exports.json` format with `classes`, `functions`, and `grammars` fields. Uses `#[serde(default)]` for backward compatibility with existing packages that lack `exports`.

## Consuming Exports

### Import Syntax

Packages use the existing `import ... from` syntax to import specific items from dependencies:

```ink
import Wallet, format_currency from economy
```

This maps to the existing `Stmt::ImportFrom` AST node with `path: vec!["economy"]` and `items: vec!["Wallet", "format_currency"]`. The `path` field is a `Vec<String>` containing a single element for package imports. No new syntax or keywords are needed — the compiler extends the existing import resolution to validate against `exports.json` for package-level imports (as opposed to file-level imports which use `import ... from "./path"`).

### Compile-Time Validation

The import resolver is extended to handle `Stmt::ImportFrom` with a non-file path (i.e., a package name). For package imports:

1. Resolve the import path to a dependency package from `quill.toml` `[dependencies]`
2. Load the dependency's `exports.json` from the package cache (`~/.quill/cache/<pkg>/`)
3. Verify each imported item exists in `classes`, `functions`, or `grammars`
4. Check visibility: if the item is `internal`, verify the importing package shares the same author
5. Emit a compile error if the import doesn't resolve or visibility check fails

**Missing `exports.json`**: If a dependency has no `exports.json` (e.g., published before this feature existed, or built with an older quill version), the compiler emits a warning rather than a hard error: `warning: package 'economy' has no exports metadata — import validation skipped`. This maintains backward compatibility with pre-exports packages.

The lockfile guarantees the cache contains the correct resolved version of each dependency.

### Error Cases

- **Unknown export**: `error: 'Wallet' is not exported by 'economy'`
- **Internal import**: `error: 'Ledger' is internal to 'economy' and not available to 'my-package'`
- **Missing dependency**: `error: package 'economy' is not listed in dependencies`

## `quill.toml` Changes

No changes to `quill.toml` are required. The exports are entirely compiler-generated. The manifest stays clean:

```toml
[package]
name = "economy"
version = "1.0.0"
type = "library"

[dependencies]
ink.paper = "^1.0.0"
```

The `exports.json` file is added to `.gitignore` by default since it's a build artifact.

## File Locations

| File | Location | Generated |
|------|----------|-----------|
| `exports.json` | Project root (next to `quill.toml`) | Yes, by `quill build` |
| `exports.json` | Package cache (`~/.quill/cache/<pkg>/`) | Downloaded from registry on install |
| `exports.json` | Published tarball root | Included by `quill publish` from project root |

Note: `exports.json` lives in the project root (not `target/`) because `quill publish` excludes `target/` from the tarball.

## Implementation Scope

### Compiler (printing_press)

1. Add `@internal` annotation recognition in the existing `parse_annotations` function
2. Add `internal: bool` field to AST nodes for class, function, and method declarations
3. After compilation, walk the AST to collect all top-level classes and functions
4. Generate `exports.json` (version 1) from the collected data
5. Include grammar namespace identifiers from grammar source files

### CLI (quill)

1. `quill build` — generate `exports.json` in the project root as a build step
2. `quill publish` — include project-root `exports.json` in the tarball, send to registry
3. `quill info <package>` — display exports from cached `exports.json`
4. `quill search` — show export data in search results (class count, function count, grammar names)

### Import Resolver Extension

1. Extend `import_resolver.rs` to handle `Stmt::ImportFrom` with a package path (non-file path)
2. Load dependency `exports.json` from cache during resolution
3. Validate imported items exist and pass visibility checks
4. Report errors for invalid imports

### Registry (lectern)

1. Accept `exports.json` as part of publish payload
2. Index export data for search (class names, function names, grammar names)
3. Include exports in package metadata responses
4. Add `exports` column/field to the registry index schema
