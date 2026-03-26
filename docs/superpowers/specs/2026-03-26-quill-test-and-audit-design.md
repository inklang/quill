# Quill Test and Audit Commands — Design

## Overview

Two new CLI commands for quill:
- **`quill test`** — runs tests for Quill packages
- **`quill audit`** — security and integrity checks for packages

---

## `quill test`

### `quill test` (no flags)

Runs Quill's own vitest test suite. Delegates entirely to `vitest` with output piped to the terminal.

```bash
quill test                 # runs vitest with default config
quill test --watch         # runs vitest in watch mode
```

**Implementation:** spawn `vitest` as a child process, pipe stdout/stderr to terminal, exit with the same exit code.

### `quill test --ink`

Runs tests for an Ink grammar package. Expects a `tests/` directory in the project root containing `*_test.ink` files.

```bash
quill test --ink           # compile and run Ink test files
```

**Test file convention:** `tests/*_test.ink` — files matching `*_test.ink` in the `tests/` directory. Non-recursive (no subdirectories). Files named `*_test.ink` but containing no `fn test_` functions are skipped with a warning.

**Test file format:**

```ink
# tests/math_test.ink

fn test_addition() {
  assert(2 + 2 == 4, "addition should work")
}

fn test_multiplication() {
  assert(3 * 4 == 12)
}

fn test_string_concat() {
  assert("hello" + " " + "world" == "hello world")
}
```

- **Test functions:** declared with `fn test_<name>()` — no arguments, no return value
- **`assert(condition, message?)`:** built-in function provided by Ink runtime. Throws an `AssertionError` if condition is falsy. Optional `message` string appears in failure output.
- **`fail(message)`:** built-in function. Throws immediately with `message`.
- All code outside functions runs first (for setup), then each `test_` function runs in declaration order.

**Execution model:**
1. Quill discovers all `tests/*_test.ink` files (non-recursive)
2. Compiles each test file using the Ink compiler (single-file compile, same as scripts)
3. For each compiled `.inkc`, Quill spawns the Ink VM with a special `TestContext` that:
   - Catches thrown `AssertionError` or `Error` objects
   - Records pass/fail per test function
   - Collects any `print()` output for diagnostics
4. Results are aggregated and printed

**Error handling:** If a test file fails to compile, it is reported as FAILED with the compiler error and the command exits non-zero. If one test function fails within a file, other test functions in that file still run (no early exit).

**Output format (text):**
```
Running Ink tests...

tests/math_test.ink:
  ✓ test_addition
  ✗ test_multiplication
    Assertion failed: expected 12, got 15
  ✓ test_string_concat

2 passed, 1 failed
```

**Output format (--json):**
```json
{
  "passed": 2,
  "failed": 1,
  "suites": [
    {
      "file": "tests/math_test.ink",
      "tests": [
        { "name": "test_addition", "status": "passed" },
        { "name": "test_multiplication", "status": "failed", "error": "Assertion failed: expected 12, got 15" },
        { "name": "test_string_concat", "status": "passed" }
      ]
    }
  ]
}
```

**Partial failure:** If any test fails, exit code is 1. Files with no `fn test_*` functions are skipped with a warning. If `tests/` does not exist, exit 0 with `No tests to run.`

---

## `quill audit`

Performs security and integrity checks on a package. Can be run on an installed package or against the registry.

```bash
quill audit                    # audit all installed packages
quill audit <pkg>             # audit a specific installed package
quill audit <pkg>@<version>   # audit a specific version
```

### Check 1: Dependency Vulnerabilities

Queries the [OSV.dev API](https://osv.dev) for each dependency of the target package.

- **API endpoint:** `POST https://api.osv.dev/v1/query` with `{ "package": { "name": "pkg", "version": "ver" } }`
- **No auth required**
- Returns CVEs affecting the package version

**Output format:**
```
pkg @ 1.2.0:
  VULNERABLE - CVE-2024-1234: buffer overflow in parser
    Severity: HIGH
    Fixed in: 1.2.1
  ...
```

If no vulnerabilities found: print `No vulnerabilities found.`

### Check 2: Bytecode Safety

Scans `.inkc` bytecode files from the package for disallowed operations.

**Disallowed operations (flagged as SUSPICIOUS):**
- `file_read` / `file_write` — filesystem access
- `http_request` — outbound network calls
- `db_write` — database writes outside allowed patterns
- `exec` — arbitrary code execution
- `eval` — dynamic evaluation

**Output format:**
```
scripts/event_handler.inkc:
  WARNING: file_write operation detected
    Contains write to /plugins/ink/data.json

scripts/network.inkc:
  BLOCKED: http_request operation detected
    Cannot be allowed in published packages.
```

Note: bytecode is JSON, so references are to the operation name and context (e.g., the file path being written), not source line numbers.

If no issues found: print `No bytecode safety issues found.`

### Check 3: Manifest Integrity (Checksum Verification)

Verifies the SHA-256 checksum of the downloaded tarball against the registry-stored checksum.

**Checksum storage:**
- Registry index stores `checksum: "sha256:<hash>"` per version
- Also returned in package metadata so client has it offline

**Verification flow:**
1. Download tarball (or use cached)
2. Compute SHA-256 of downloaded bytes
3. Compare to registry index checksum
4. Compare to package metadata checksum (if present)

**Output format (on mismatch):**
```
CHECKSUM MISMATCH for ink.mobs@1.0.0:
  Expected (registry):  sha256:abc123...
  Computed:             sha256:def456...
  Package metadata:      sha256:abc123...

  Package may have been tampered with. DO NOT INSTALL.
```

On match: `Integrity check passed for <pkg>@<version>.`

---

## Integration: `quill add` → Audit Before Install

`quill add <pkg>` runs a lightweight audit before installing:

1. Perform dependency vulnerability check on the package
2. If vulnerabilities found: print warning with details, then prompt:
   ```
   Vulnerabilities found in ink.mobs@1.0.0:
     - CVE-2024-1234: buffer overflow

   Install anyway? [y/N]
   ```
3. User presses `y` to confirm, `n` or Enter to cancel
4. `--force` flag (`quill add <pkg> --force`) skips the prompt and installs regardless

**Note:** Full bytecode scan and checksum verification happen during `quill add` as well, but the checksum check is non-negotiable — if checksums don't match, installation fails even with `--force`.

---

## Flags

| Flag | Applies to | Description |
|------|-------------|--------------|
| `--json` | `test`, `audit` | JSON output |
| `--force` | `add` | Skip audit confirmation prompt |
| `--watch` | `test` | Run in watch mode (vitest) |
| `--offline` | `audit` | Skip OSV API lookup (vulns only) |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks passed / no issues found |
| 1 | Vulnerabilities or warnings found |
| 2 | Checksum mismatch (integrity failure) |
| 3 | Audit could not complete (network error, etc.) |

---

## File Changes

**New files:**
- `src/commands/test.ts` — test command
- `src/commands/audit.ts` — audit command
- `src/audit/vulnerabilities.ts` — OSV API client
- `src/audit/bytecode.ts` — bytecode scanner
- `src/audit/checksum.ts` — checksum verifier
- `tests/commands/test.test.ts` — CLI test tests
- `tests/commands/audit.test.ts` — CLI audit tests

**Modified files:**
- `src/cli.ts` — register `test` and `audit` commands
- `src/commands/add.ts` — integrate audit before install
- `src/registry/client.ts` — add `getChecksum(pkg, version)` method

---

## Dependencies

- No new runtime dependencies (uses built-in `crypto` for SHA-256)
- OSV API is public and requires no authentication
