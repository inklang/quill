# Incremental Build Cache — Design Spec

## Overview

Add incremental build support to `quill build` via a local cache, avoiding full recompilation of unchanged `.ink` scripts. A `quill cache` command provides visibility and manual invalidation.

## Cache Storage

Location: `<project>/.quill/cache/`

```
.quill/cache/
  manifest.json    # build cache manifest
```

### `manifest.json` shape

```json
{
  "version": 1,
  "lastFullBuild": "2026-03-25T12:00:00.000Z",
  "grammarIrHash": "abc123...",
  "entries": {
    "scripts/hello.ink": {
      "hash": "def456...",
      "output": "hello.inkc",
      "compiledAt": "2026-03-25T12:00:01.000Z"
    }
  }
}
```

- `version` — schema version, allows future format changes
- `lastFullBuild` — timestamp of last `--full` build
- `grammarIrHash` — SHA-256 of `dist/grammar.ir.json` (if present), used to detect grammar changes
- `entries` — one entry per compiled script; keyed by relative path from project root

## How It Works

### `quill build` (incremental)

1. Read existing `.quill/cache/manifest.json` if present
2. Hash each `.ink` file under `scripts/`
3. Compare against stored hashes in manifest
4. For **dirty** files (hash mismatch or new): invoke `printing_press <file> -o <outDir>/<name>.inkc` using single-file mode
5. For **clean** files: skip — output already in `dist/scripts/`
6. After compilation: update manifest with new hashes
7. If `--full` was not passed and manifest's `grammarIrHash` differs from current `dist/grammar.ir.json` → mark all scripts dirty (grammar changed)

### `quill build --full`

1. Ignore existing manifest
2. Compile all `.ink` files using batch mode (`--sources scripts/ --out dist/scripts/`)
3. Write fresh manifest with all entries
4. Set `lastFullBuild` to now

Flag: `--full` (alias `-F`)

### `quill cache`

Reads and displays:
- Cache directory path (`.quill/cache`)
- Total size on disk
- Number of cached entries
- `lastFullBuild` timestamp
- List of cached files with their hashes

Example output:
```
Cache: .quill/cache
Size:  12.4 KB
Entries: 5
Last full build: 2026-03-25 12:00:00

scripts/hello.ink  abc123  →  hello.inkc
scripts/fight.ink  def456  →  fight.inkc
```

### `quill cache clean`

Deletes `.quill/cache/` directory entirely. Subsequent `quill build` will do a full incremental build (all files appear dirty).

## Key Decisions

- **Single-file mode for incremental compiles**: `printing_press compile <file> -o <out>` is used per dirty file, not batch mode. Batch mode only used for `--full`.
- **Grammar invalidation is aggressive**: any change to `dist/grammar.ir.json` invalidates all scripts. We don't track which scripts use which grammar rules — recompiling all is safe.
- **Hash algorithm**: SHA-256 via Node.js `crypto.createHash('sha256')`. Input is raw file content (`readFileSync` buffer).
- **Cache lives in project**: `.quill/cache/` is git-ignored (assumed in `.gitignore`). This keeps cache per-project.
- **Incremental build only affects scripts**: grammar IR building (`buildGrammar`) is always run fresh — it's fast and deterministic enough. Runtime JAR always rebuilt via Gradle if present.

## Affected Files

### New files
- `src/cache/manifest.ts` — cache manifest types and helpers
- `src/cache/commands.ts` — `quill cache` and `quill cache clean` commands
- `src/cache/util.ts` — hash computation, dirty-file detection

### Modified files
- `src/commands/ink-build.ts` — add `--full` flag, integrate incremental compilation logic
- `src/cli.ts` — register `cache` and `cache clean` subcommands, add `--full` to `build`

## Implementation Order

1. Add `manifest.ts` types and helpers
2. Add `quill cache` and `quill cache clean` commands
3. Modify `ink-build.ts` to support `--full` and incremental script compilation
4. Add tests for cache commands and incremental build behavior
