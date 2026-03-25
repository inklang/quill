# Quill QoL Features Design

## Overview

Add three new CLI commands to quill: `search`, `info`, and `doctor`. These improve the developer experience for discovering and debugging packages.

## Feature 1: `quill search <query>`

### Behavior
- Queries the registry search API (`GET /api/search?q=<query>`)
- Returns packages matching the query with name, version, description, and score
- Paginated: 10 results per page

### CLI Interface
```
quill search <query> [options]
Options:
  --page <n>     Page number (default: 1)
  --json         Output raw JSON
```

### Output Format (default)
```
mobs@0.1.0    Add mobs to your game
chat@0.2.0    Player chat handling
```
- Name+version in bold/color, description truncated to fit terminal width
- If no results: `No packages found matching "<query>"`

### Output Format (`--json`)
```json
[
  { "name": "mobs", "version": "0.1.0", "description": "Add mobs to your game", "score": 0.95 },
  ...
]
```

### Error Handling
- Network error: `error: Failed to search registry: <message>`
- Empty query: `error: Search query required`

---

## Feature 2: `quill info <pkg>`

### Behavior
- Fetches package details from registry index
- Shows latest version by default
- Specific version via `--version` flag

### CLI Interface
```
quill info <pkg> [options]
Options:
  --version <ver>   Show specific version (default: latest)
  --json             Output raw JSON
```

### Output Format (default)
```
mobs@0.1.0
  Description: Add mobs to your game with full event handling
  Version: 0.1.0
  Dependencies: ink.core@^0.1.0
  Homepage: https://github.com/inklang/ink.mobs
```

### Output Format (`--json`)
```json
{
  "name": "mobs",
  "version": "0.1.0",
  "description": "Add mobs to your game with full event handling",
  "dependencies": { "ink.core": "^0.1.0" },
  "homepage": "https://github.com/inklang/ink.mobs"
}
```

### Error Handling
- Package not found: `error: Package "<pkg>" not found in registry`
- Version not found: `error: Version "<ver>" not found for "<pkg>"`
- Network error: `error: Failed to fetch package info: <message>`

---

## Feature 3: `quill doctor`

### Behavior
- Runs a series of diagnostic checks
- Reports status per check: ✓ pass, ✗ fail, ⚠ warning
- Exits with code 1 if any check fails

### Diagnostic Checks

**1. Registry Connectivity**
- Fetch `GET /index.json`
- Pass: can reach registry
- Fail: network error or non-200 response

**2. Auth Status**
- Check for `QUILL_TOKEN` env var or `~/.quillrc` token
- Pass: token exists and is non-empty
- Warn: no token (user can't publish)

**3. Project State** (if run inside a project)
- Check `ink-package.toml` exists
- Pass: file exists and is valid TOML
- Fail: file missing
- Warn: file exists but parse fails

**4. Dependencies** (if project has dependencies)
- Check each dep in `quill.lock` exists in registry
- Pass: all deps found
- Warn: some deps not found

**5. NVIDIA API** (optional, for search features)
- Ping NVIDIA endpoint
- Pass: responds with 200
- Warn: unreachable (search will fail)

### CLI Interface
```
quill doctor [options]
Options:
  --json       Output JSON with all check results
  --fix        Attempt auto-fix where possible
```

### Output Format (default)
```
Doctor check results:
  ✓ Registry:          reachable
  ⚠ Auth:              no token found (run `quill login` to publish)
  ✓ ink-package.toml:  valid
  ✓ Dependencies:      all installed

5 checks, 3 passed, 1 warning, 0 failed
```

### Exit Codes
- 0: all checks passed
- 1: one or more checks failed or warned

---

## File Structure

```
src/
  commands/
    search.ts        (new)
    info.ts          (new)
    doctor.ts        (new)
  registry/
    client.ts        (add searchPackage method)
  util/
    doctor.ts        (new - health check implementations)
```

---

## Implementation Notes

- Use existing `RegistryClient` for registry API calls
- Add `searchPackages(query: string, page: number): Promise<SearchResult[]>` to `RegistryClient`
- Add `getPackageInfo(name: string, version?: string): Promise<PackageInfo>` to `RegistryClient`
- Add `--json` flag to commands using `console.log(JSON.stringify(...))`
- Use `console.error()` for all error messages
- Terminal width detection: `process.stdout.columns` or default 80
