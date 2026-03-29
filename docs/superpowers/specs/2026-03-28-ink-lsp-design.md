# Ink LSP — Language Server + VS Code Extension

**Date:** 2026-03-28
**Status:** Approved
**Repo:** `ink-lsp` (separate from quill)

## Overview

A VS Code extension with an LSP server for the Ink language. Provides syntax highlighting and full language features (autocomplete, diagnostics, hover) that dynamically adapt based on which grammar packages a project has installed.

## Architecture

**Three-layer highlighting:**
1. Static TextMate grammar — base Ink keywords (instant, no server needed)
2. Semantic tokens — grammar-package keywords computed by the LSP server (context-aware)
3. LSP intelligence — autocomplete, diagnostics, hover

## Repo Structure

```
ink-lsp/
├── package.json                 # VS Code extension manifest
├── tsconfig.json
├── esbuild.mjs                  # Build config
├── src/
│   ├── extension.ts             # Extension host entry point
│   ├── server/
│   │   ├── server.ts            # LSP server entry point
│   │   ├── parser.ts            # Scope-aware tokenizer
│   │   ├── grammar-loader.ts    # Reads grammar.ir.json from packages/
│   │   ├── features/
│   │   │   ├── completion.ts    # Autocomplete provider
│   │   │   ├── diagnostics.ts   # Error/warning provider
│   │   │   ├── hover.ts         # Hover documentation
│   │   │   └── semantic-tokens.ts # Dynamic keyword highlighting
│   │   └── types.ts             # Shared types
│   └── syntaxes/
│       └── ink.tmLanguage.json  # Static TextMate grammar
├── language-configuration.json  # Bracket matching, comments, indent
└── preview/                     # Test .ink files for manual testing
```

Two build bundles:
- `dist/extension.js` — runs in extension host, starts the server
- `dist/server.js` — runs as child process via stdio transport

## Static TextMate Grammar

Ships with the extension. Covers base Ink language keywords that never change:

**Keywords:** `using`, `let`, `fn`, `return`, `if`, `else`, `for`, `while`, `in`, `break`, `continue`, `class`, `self`, `null`, `true`, `false`, `throw`

**Built-ins:** `print`, `log`, `java`, `java.call`, `java.new`, `java.toString`, `java.getStatic`, `java.putStatic`, `java.type`, `java.cast`, `io`, `json`, `Math`, `db`

**Token scopes:**
| Scope | What it matches |
|---|---|
| `keyword.control.ink` | `if`, `else`, `for`, `while`, `in`, `break`, `continue`, `return` |
| `keyword.declaration.ink` | `let`, `fn`, `class`, `using` |
| `support.function.ink` | `print`, `log` |
| `support.class.ink` | `java`, `Math`, `io`, `json`, `db` |
| `constant.language.ink` | `true`, `false`, `null`, `self` |
| `string.quoted.double.ink` | `"..."` strings |
| `constant.numeric.ink` | integers and floats |
| `comment.line.double-slash.ink` | `// comments` |
| `keyword.operator.ink` | `+`, `-`, `*`, `/`, `%`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `!`, `=` |

**Language configuration:** Bracket pairs `{}`, `()`, `[]`, comment toggle `//`, auto-closing pairs, indentation after `{`.

## Grammar Loader

Discovers and loads grammar package definitions at runtime.

**Initialization:**
1. Read `ink-package.toml` from workspace root — get project name and dependencies
2. Read `quill.lock` — resolve exact versions and locations
3. For each dependency, find `grammar.ir.json`:
   - `packages/<pkg-name>/dist/paper/grammar.ir.json` (targeted)
   - `packages/<pkg-name>/dist/grammar.ir.json` (default)
4. Load project's own grammar from `dist/grammar.ir.json`
5. Merge all grammars into a unified grammar context

**Grammar context provides:**
- Merged keyword list (all keywords from all packages)
- Declaration map: `keyword → DeclarationDef` (scopeRules, inheritsBase)
- Rule map: `ruleId → RuleDef` (full structure for autocomplete suggestions)
- Scope lookup: given a declaration keyword, which clause keywords are valid in its block

**File watching:** Watch `ink-package.toml`, `quill.lock`, and `packages/*/grammar.ir.json`. On change, reload grammar context and refresh all open `.ink` files.

**Caching:** Parsed grammar IR cached by file path + mtime. Re-parsed only on change.

## Parser

A scope-aware tokenizer — not a full AST parser. Tracks enough context to power IDE features.

**Tracks:**
- Top-level scope (`using` statements, base declarations, function calls)
- Declaration scope (e.g., inside `mob Foo { ... }` → we're in a `mob` block)
- Nesting (blocks within blocks)
- Current line context for autocomplete

**Per-line output:**
- Token type (keyword, identifier, string, int, float, operator, comment)
- Scope stack (e.g., `["declaration:mob", "clause:on_spawn"]`)
- Whether inside a string literal

**Scope tracking:**
```
for each line:
  if matches "using <pkg>" → record import
  if matches "<keyword> <name> {" → push declaration scope
  if matches "}" → pop scope
  track current position's scope stack
```

No expression parsing, no type inference. Just scope context.

## LSP Features

### Semantic Tokens

Overlaid after TextMate. Highlights grammar-package keywords contextually:

| Token type | Highlights | Example |
|---|---|---|
| `declaration` | Declaration keywords | `mob`, `player`, `command`, `task` |
| `clause` | Clause keywords inside declarations | `on_spawn`, `on_death`, `every` |
| `property` | Config/entry keywords | `permission`, `alias`, `file` |

`on_spawn` is only highlighted as a clause keyword when inside a `mob` block.

### Autocomplete

Context-sensitive based on cursor scope:

| Location | Offers |
|---|---|
| Top-level, outside blocks | Declaration keywords (`mob`, `player`, etc.) + base keywords (`let`, `fn`, `for`) |
| Inside declaration block | Valid clause keywords for that declaration |
| Inside clause block | Base language completions (`let`, `if`, `java.call`, built-ins) |
| After `using` | Package names from lockfile |

### Diagnostics

- Invalid clause keyword inside a declaration → error (e.g., `on_spawn` in `command` block)
- Unknown `using` package → warning
- Duplicate declaration names → warning

### Hover

- Declaration keyword → valid clauses, source package
- Clause keyword → expected syntax pattern from rule definition

## Extension Lifecycle

**Activation:** Opens when any `.ink` file is opened.

**Server transport:** stdio (Node.js child process).

**Message flow:**
1. `initialize` — receive workspace root, load grammars
2. `textDocument/didOpen` — parse, compute semantic tokens + diagnostics
3. `textDocument/didChange` — re-parse, update
4. `textDocument/completion` — scope-based suggestions
5. `textDocument/hover` — documentation
6. File watch trigger → reload grammars, refresh all files
7. `shutdown` — cleanup

## Dependencies

- `vscode-languageclient` (extension side)
- `vscode-languageserver` (server side)
- No other runtime dependencies — grammar IR is plain JSON parsing

## Out of Scope (v1)

- Method/property autocomplete on objects (`world.`, `entity.`, `player.`)
- Go-to-definition across files
- Code formatting
- Signature help
- Rename refactoring
- Code actions / quick fixes
