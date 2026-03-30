# Inline TUI Improvements: install, build, audit

**Date:** 2026-03-30
**Status:** Approved

## Overview

Three Quill CLI commands currently produce bare `println!` output with no visual feedback during async operations. This spec covers adding inline progress/styled output to `install`, `build`, and `audit` using `indicatif` for progress bars and spinners, and `crossterm` colors (already a dep) for audit severity highlighting.

The `search` command already uses ratatui in alternate-screen mode. These three commands use *inline* output — output stays in the scrollback buffer, no alternate screen.

---

## Dependencies

Add to `Cargo.toml`:

```toml
indicatif = { version = "0.17", features = ["tokio"] }
```

`crossterm` is already a dependency (used by `search`). No new dep needed for audit colors.

---

## 1. `quill install`

### Current behavior
Downloads N packages sequentially with no output until the very end: `Installed X dependencies`.

### New behavior

Use `indicatif::MultiProgress` with one `ProgressBar` per package.

**During install:**
```
  ✓ other-package          cached
  ⠸ my-package             downloading  1.2 MB / 3.4 MB
  ⠼ third-package          downloading  ...
```

- Packages already in cache resolve instantly with a `cached` tick (no bar shown, immediate ✓)
- Downloads run **concurrently** via `tokio::spawn` per package (replaces current sequential loop — free perf win)
- Each bar shows: package name (padded), status label, byte progress when `Content-Length` is known; spinner when unknown
- On error: the failing bar turns red, shows the error message inline; other downloads continue to completion
- On all complete: bars clear, single summary line printed: `  ✓ Installed 3 packages`

### Key implementation notes

- `MultiProgress` must be created before spawning tasks and cloned into each task
- Use `ProgressBar::new(total_bytes)` when `Content-Length` header is present, `ProgressBar::new_spinner()` otherwise
- Finish with `pb.finish_with_message(...)` per bar so completed bars stay visible
- The download function needs to stream the response body and call `pb.inc(chunk.len() as u64)` per chunk — this requires changing from "download to file" to a streaming approach

---

## 2. `quill build`

### Current behavior
Prints one `println!` line per completed step, no indication of what's currently happening.

### New behavior

A single `ProgressBar` in spinner style that mutates its message as each step starts, then prints a completed line when each step finishes.

**During build:**
```
  ✓ Grammar parsed
  ✓ Merged 2 dependency grammars
  ⠸ Compiling src/main.ink...
```

**On success:**
```
  ✓ Grammar parsed
  ✓ Merged 2 dependency grammars
  ✓ Compiled → target/ink/main.inkc
  ✓ Exports collected (3 classes, 5 functions)
  ✓ Cache updated
  ✓ Build complete
```

**On failure:**
```
  ✓ Grammar parsed
  ✓ Merged 2 dependency grammars
  ✗ Compile failed: src/main.ink:12: unexpected token '}'
```

Steps (in order):
1. Parse local grammar
2. Merge dependency grammars (skipped/instant if no deps)
3. Compile entry point
4. Collect exports (non-fatal: shows warning on failure, does not stop build)
5. Update cache
6. Write ink-manifest.json

### Key implementation notes

- Use `indicatif::ProgressBar::new_spinner()` with `enable_steady_tick`
- Use `println_above` / `suspend` pattern or `MultiProgress::println` to keep completed steps in scrollback while spinner updates
- The spinner is created once; each step calls `pb.set_message("Compiling...")`, then `pb.println("  ✓ step done")` on success or `pb.abandon_with_message("  ✗ error")` on failure
- Non-TTY fallback: keep existing `println!` behavior (check `std::io::stdout().is_terminal()`)

---

## 3. `quill audit`

### Current behavior
All severity levels look identical in plain text output. `[Critical]` and `[Low]` are visually indistinguishable.

### New behavior

Colored severity badges using `crossterm` styling. No TUI widget, no alternate screen — just colored `print!` calls.

**While scanning:**
```
  Scanning bytecode...
  Scanning dependencies (12 packages)...
```

**Clean result:**
```
  ✓ No vulnerabilities found
```

**With vulnerabilities:**
```
  Found 3 vulnerability(ies):

  [CRITICAL] CVE-2024-1234
    my-package@1.0.0
    buffer overflow in deserialization path
    https://osv.dev/...

  [HIGH]     CVE-2024-5678
    ...

  [MEDIUM]   CVE-2024-9999
    ...
```

Severity color mapping:
| Severity | Color |
|----------|-------|
| CRITICAL | Red bold |
| HIGH     | Red |
| MEDIUM   | Yellow |
| LOW      | Blue |
| UNKNOWN  | Dark gray |

Only the severity badge `[CRITICAL]` etc. is colored. Package name, summary, and references stay default white/terminal color for readability on any terminal theme.

### Key implementation notes

- Use `crossterm::style::{SetForegroundColor, Color, Attribute, ResetColor}` via `execute!(stdout, ...)`
- Helper function `print_severity(severity: &str)` that maps severity string to crossterm color and prints the badge
- Non-TTY fallback: check `std::io::stdout().is_terminal()`, fall back to plain `[CRITICAL]` if not a TTY

---

## Non-TTY Behavior

All three commands must detect non-TTY stdout and fall back to plain text output. This ensures correct behavior when piped (`quill install | tee log.txt`) or run in CI.

Pattern:
```rust
if !std::io::stdout().is_terminal() {
    // existing plain println! behavior
    return plain_output(...).await;
}
// indicatif / colored output
```

`search` already implements this pattern — follow the same approach.

---

## Out of Scope

- `outdated`, `ls`, `info` — deferred
- Interactive TUI for any of these three commands
- Ratatui inline viewport (not needed given crossterm is sufficient for audit)
