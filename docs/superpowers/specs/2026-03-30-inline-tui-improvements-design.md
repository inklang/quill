# Inline TUI Improvements: install, build, audit

**Date:** 2026-03-30
**Status:** Approved

## Overview

Three Quill CLI commands currently produce bare `println!` output with no visual feedback during async operations. This spec covers adding inline progress/styled output to `install`, `build`, and `audit` using `indicatif` for progress bars and spinners, and `crossterm` colors (already a dep) for audit severity highlighting.

The `search` command already uses ratatui in alternate-screen mode. These three commands use *inline* output — output stays in the scrollback buffer, no alternate screen.

---

## Dependencies

Two changes to `Cargo.toml`:

```toml
# Add the tokio feature to the existing indicatif entry:
indicatif = { version = "0.17", features = ["tokio"] }

# Add "stream" to reqwest features (needed for bytes_stream() in download):
reqwest = { version = "0.12", features = ["json", "multipart", "blocking", "stream"] }
```

`crossterm` is already a dependency (used by `search`). No other new deps needed.

---

## 1. `quill install`

### Current behavior
Downloads N packages sequentially in a `for` loop with no output until the end: `println!("Installed {} dependencies", resolved.len())`. `client.download_package(url, dest)` collects the entire response body with `response.bytes().await` before writing to disk — no streaming.

### New behavior

Use `indicatif::MultiProgress` with one `ProgressBar` per package.

**During install:**
```
  ✓ other-package          cached
  ⠸ my-package             downloading  1.2 MB / 3.4 MB
  ⠼ third-package          downloading  ...
```

- Packages already in cache resolve instantly with a `cached` tick (immediate ✓, no bar)
- Downloads run **concurrently** via `tokio::spawn` per package
- Each bar shows: package name (padded), status label, byte progress when `Content-Length` is known; spinner when unknown
- On error: failing bar turns red, shows error message; other downloads continue
- On all complete: single summary line: `  ✓ Installed 3 packages`

### Implementation notes

**Pre-flight check before spawning tasks:** Before spawning any concurrent tasks, do a single synchronous pass over all resolved packages to:
1. Compute each package's `tarball_path` (i.e., `cache_dir/packages/<name>/package.tar.gz`)
2. If `self.offline && !tarball_path.exists()` → return `Err` immediately (early return, preserving existing behavior)
3. Call `std::fs::create_dir_all(&package_cache_dir)` for packages that need downloading

Only after this pre-flight pass passes without error, proceed to spawn concurrent download tasks.

**Streaming download — signature change:** `RegistryClient::download_package` currently uses `response.bytes().await`. Change the signature to accept a progress bar and stream chunks:

```rust
pub async fn download_package(
    &self,
    url: &str,
    dest: &Path,
    pb: Option<&ProgressBar>,
) -> Result<()>
```

Replace `response.bytes().await` with chunk streaming:
```rust
let content_length = response.content_length();
if let (Some(pb), Some(len)) = (pb, content_length) {
    pb.set_length(len);
}
use futures_util::StreamExt;
let mut stream = response.bytes_stream();  // requires reqwest "stream" feature
while let Some(chunk) = stream.next().await {
    let chunk = chunk.map_err(...)?;
    file.write_all(&chunk).await.map_err(...)?;
    if let Some(pb) = pb {
        pb.inc(chunk.len() as u64);
    }
}
```

`futures_util` is available via the `futures-util` crate which reqwest depends on transitively; add `futures-util` as a direct dep if needed, or use `tokio_util::io` as an alternative.

**MultiProgress + concurrent tasks:** `RegistryClient` already derives `Clone`. Create `MultiProgress` in `execute`, clone the client into each spawned task, pass the relevant `ProgressBar` into `download_package`. Collect `JoinHandle<Result<()>>` and `join_all`. Propagate errors after all tasks complete.

**Non-TTY fallback:** Check `std::io::stdout().is_terminal()` at the top of `execute`. If false, run the existing sequential plain-text logic unchanged (mirrors `search.rs`).

---

## 2. `quill build`

### Current behavior
`build.rs` has 9 numbered comment steps. Steps are synchronous. Currently one `println!` per completed step.

### New behavior

A single spinner `ProgressBar` that updates its message per step. Completed steps are printed above the spinner permanently; the spinner tracks the current in-progress step.

**During build:**
```
  ✓ Parsed grammar
  ✓ Merged 2 dependency grammars
  ⠸ Compiling src/main.ink...
```

**On success:**
```
  ✓ Parsed grammar
  ✓ Merged 2 dependency grammars
  ✓ Compiled → target/ink/main.inkc
  ✓ Exports collected (3 classes, 5 functions)
  ✓ Written target/ink/ink-manifest.json
  ✓ Cache updated
  ✓ Build complete
```

**On failure:**
```
  ✓ Parsed grammar
  ✓ Merged 2 dependency grammars
  ✗ Compile failed: src/main.ink:12: unexpected token '}'
```

### Step mapping to existing code steps

| Spinner step | Code step(s) | Notes |
|---|---|---|
| Parsing grammar... → ✓ Parsed grammar | 1 (resolve target) + 2 (parse grammar) | Target resolution is instant; combine into grammar step |
| Merging grammars... → ✓ Merged N dependency grammars | 3 (merge dep grammars) | Skip spinner update entirely if no deps (go straight from step 1 to compile) |
| Compiling... → ✓ Compiled → `<path>` | 4 (determine entry) + 5 (compile) | |
| Collecting exports... → ✓ Exports collected | 6 (generate exports.json) | Non-fatal: on failure call `pb.println("  ! exports collection failed: ...")` and continue |
| Writing manifest... → ✓ Written `<path>` | 8 (write ink-manifest.json) | |
| Updating cache... → ✓ Cache updated | 9 (write cache) | Step 7 (load cache from disk) is a silent read — no spinner update needed, just do it inline |

### Implementation notes

- Use `ProgressBar::new_spinner()` with `pb.enable_steady_tick(Duration::from_millis(80))`
- To print a completed step line above the spinner: use `pb.println("  ✓ ...")` — this is the correct indicatif 0.17 API (`println_above` does not exist)
- To update the spinner message for the current step: use `pb.set_message("Compiling src/main.ink...")`
- On error: call `pb.finish_with_message("  ✗ step: error message")` and return `Err`
- On success: call `pb.finish_and_clear()`, then `println!("  ✓ Build complete")`
- **Non-TTY fallback:** Check `std::io::stdout().is_terminal()`. If false, keep existing `println!` output unchanged.

---

## 3. `quill audit`

### Current behavior
All severity levels look identical in plain text. `VulnerabilityIssue` has fields: `id`, `severity`, `summary`, `references`. No `package` field — for bytecode issues the file path is embedded in `id`; for OSV issues the package name is only available in the calling loop in `scan_dependencies`.

### New behavior

Colored severity badges using `crossterm`. No TUI widget, no alternate screen.

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
    my-package
    buffer overflow in deserialization path
    https://osv.dev/...

  [HIGH]     CVE-2024-5678
    Summary: ...
```

### Severity color mapping

| Severity | Color |
|----------|-------|
| CRITICAL | Red + bold |
| HIGH     | Red |
| MEDIUM   | Yellow |
| LOW      | Blue |
| UNKNOWN  | Dark gray |

Only the severity badge `[CRITICAL]` etc. is colored. All other text stays default terminal color.

### Implementation notes

**Add `package` field to `VulnerabilityIssue`:**
```rust
struct VulnerabilityIssue {
    id: String,
    severity: String,
    summary: String,
    references: Vec<String>,
    package: Option<String>,  // add this
}
```
In `scan_dependencies`, populate `package: Some(name.clone())` (the `name` variable is already in scope in the loop). For bytecode issues in `scan_bytecode`, leave `package: None` (the file path in `id` already identifies the location).

**`print_severity_badge` helper:**
```rust
fn print_severity_badge(severity: &str, is_tty: bool) {
    if !is_tty {
        print!("[{}]", severity.to_uppercase());
        return;
    }
    use crossterm::style::{Attribute, Color, Print, ResetColor, SetAttribute, SetForegroundColor};
    use std::io::Write;
    let color = match severity {
        "Critical" => Color::Red,
        "High"     => Color::Red,
        "Medium"   => Color::Yellow,
        "Low"      => Color::Blue,
        _          => Color::DarkGrey,
    };
    let bold = severity == "Critical";
    let mut stdout = std::io::stdout();
    if bold {
        execute!(stdout, SetAttribute(Attribute::Bold)).unwrap_or(());
    }
    execute!(
        stdout,
        SetForegroundColor(color),
        Print(format!("[{}]", severity.to_uppercase())),
        ResetColor,
    ).unwrap_or(());
    if bold {
        execute!(stdout, SetAttribute(Attribute::Reset)).unwrap_or(());
    }
}
```

**Display format:** For each issue, print:
```
  <badge> <id>\n
  [  <package>\n  (if package is Some)]
    <summary>\n
  [  <reference>\n  (for each reference)]
```

**Non-TTY fallback:** Check `std::io::stdout().is_terminal()` once at the start of `execute`, pass `is_tty: bool` through to `print_severity_badge` and any other colored output.

---

## Out of Scope

- `outdated`, `ls`, `info` — deferred
- Interactive TUI for any of these three commands
- Ratatui inline viewport
- Adding version info to OSV vulnerability output
