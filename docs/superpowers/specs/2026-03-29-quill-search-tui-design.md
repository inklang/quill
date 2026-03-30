# Quill Search TUI

## Overview

Replace the text-table `quill search` output with an interactive ratatui TUI. Live fuzzy search with debounced API calls, result browsing, detail view, and install action.

## Behavior

**Trigger**: `quill search` or `quill search <query>` always opens the TUI when a TTY is present. Falls back to text output when piped.

### Search Mode

- Top bar: text input field showing current query
- Below: scrollable list of results (name, version, description)
- Typing triggers a debounced (300ms) API call to `/api/search?q=`
- Loading indicator while request is in-flight
- Arrow keys / j/k to navigate results
- Enter opens Detail mode for the selected package
- Esc / Ctrl+C quits

### Detail Mode

- Centered card showing: name, version, description, package type, relevance score
- `i` to install (calls add command logic directly)
- Esc returns to Search mode

### Fallback

When stdout is not a TTY, print the existing text table format.

## Architecture

Single file: `commands/search.rs` contains the full TUI app.

### App State

```rust
struct SearchApp {
    query: String,
    results: Vec<SearchResult>,
    selected: usize,
    mode: Mode,
    loading: bool,
    error: Option<String>,
    last_request_id: u64,
}

enum Mode {
    Search,
    Detail,
}
```

### Event Loop

1. Spawn tokio task for crossterm event reading
2. Debounce timer: track last keystroke, fire request after 300ms idle
3. On search response: update `results`, reset `selected` to 0
4. Render via ratatui on every event

### Terminal Handling

- Crossterm backend with ratatui
- Enter raw mode + alternate screen on start
- Restore terminal on exit (via Drop guard, even on panic)

## File Changes

| File | Change |
|------|--------|
| `commands/search.rs` | Rewrite: add TUI app struct, event loop, rendering |
| `cli.rs` | Remove `--limit` flag; keep `query` as optional initial value |

No new files. No dependency changes (ratatui + crossterm already in Cargo.toml).

## Key Bindings

| Key | Mode | Action |
|-----|------|--------|
| Char input | Search | Append to query |
| Backspace | Search | Remove last char |
| Up / k | Search | Move selection up |
| Down / j | Search | Move selection down |
| Enter | Search | Open Detail mode |
| Esc | Search | Quit |
| Esc | Detail | Return to Search |
| i | Detail | Install package |
| Ctrl+C | Any | Quit |
