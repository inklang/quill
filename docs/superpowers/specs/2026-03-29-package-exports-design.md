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

- On a **class**: the class itself is internal. All its methods follow the class visibility but are individually listed as public/internal.
- On a **method**: only that method is internal. The class remains public.
- On a **function**: the function is internal.

## Compiler-Generated `exports.json`

`quill build` produces `exports.json` in the build output directory alongside the compiled `.inkc` bytecode.

### Format

```json
{
  "classes": {
    "Wallet": {
      "visibility": "public",
      "methods": ["get_balance", "deposit", "transfer"],
      "internal_methods": ["audit_log"]
    },
    "Ledger": {
      "visibility": "internal",
      "methods": ["reconcile"],
      "internal_methods": []
    }
  },
  "functions": {
    "format_currency": "public",
    "parse_amount": "internal"
  },
  "grammars": ["economy"]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `classes` | `Map<String, ClassExport>` | Exported classes with visibility and method lists |
| `functions` | `Map<String, Visibility>` | Top-level functions with visibility |
| `grammars` | `Vec<String>` | Grammar rule names contributed by this package |

**ClassExport:**

| Field | Type | Description |
|-------|------|-------------|
| `visibility` | `"public"` or `"internal"` | Whether the class is public or internal |
| `methods` | `Vec<String>` | Public method names |
| `internal_methods` | `Vec<String>` | Internal method names |

### Grammar Detection

The compiler reads the `[grammar]` section of `quill.toml` and the grammar source files to determine which grammar rules the package contributes. These are listed under `grammars` in `exports.json`.

### Method Listing

Each class entry lists both public and internal methods separately:
- `methods`: public methods available to all consumers
- `internal_methods`: methods restricted to same-author consumers

This gives consumers a complete picture of the class API even if some methods are internal, which helps with documentation, IDE support, and search.

## Publishing Flow

`quill publish` includes `exports.json` in the published tarball. The registry indexes export data so that:

- `quill search` can show what a package provides (classes, functions, grammars)
- `quill info <package>` displays the full API surface
- Consumers can inspect available exports before installing

### Registry Index Entry

The `RegistryPackageVersion` struct gains an optional `exports` field containing the `exports.json` data, indexed for search.

## Consuming Exports

### Import Syntax

Packages explicitly import what they need from dependencies:

```ink
use economy::{Wallet, format_currency}
```

### Compile-Time Validation

The compiler validates imports against dependency `exports.json` files at build time:

1. Resolve the import path to a dependency package
2. Look up the dependency's `exports.json` from the cache
3. Verify the imported item exists in `classes`, `functions`, or `grammars`
4. Check visibility: if the item is `internal`, verify the importing package shares the same author (matched by registry username or `package.author` field)
5. Emit a compile error if the import doesn't resolve or visibility check fails

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

The `exports.json` file is added to `.gitignore` by default since it's a build artifact, similar to `quill.lock`.

## File Locations

| File | Location | Generated |
|------|----------|-----------|
| `exports.json` | Build output directory (`target/` or `build/`) | Yes, by `quill build` |
| `exports.json` | Package cache (`~/.quill/cache/<pkg>/`) | Yes, downloaded from registry |
| `exports.json` | Published tarball root | Yes, included by `quill publish` |

## Implementation Scope

### Compiler (printing_press)

1. Add `@internal` annotation recognition in the lexer/parser
2. Add `internal: bool` field to AST nodes for class, function, and method declarations
3. After compilation, walk the AST to collect all top-level classes and functions
4. Generate `exports.json` from the collected data
5. Include grammar contributions from the `[grammar]` config and grammar source files

### CLI (quill)

1. `quill build` — trigger `exports.json` generation as a build step
2. `quill publish` — include `exports.json` in the tarball, send to registry
3. `quill info <package>` — display exports from cached `exports.json`
4. `quill search` — show export data in search results (class count, function count, grammar names)

### Compiler Import Validation

1. During compilation, resolve `use` statements to dependency packages
2. Load dependency `exports.json` from cache
3. Validate imported items exist and pass visibility checks
4. Report errors for invalid imports

### Registry (lectern)

1. Accept `exports.json` as part of publish payload
2. Index export data for search (class names, function names, grammar names)
3. Include exports in package metadata responses
