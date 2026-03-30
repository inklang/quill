# Quill Search TUI

## Overview

Replace the text-table `quill search` output with an interactive ratatui TUI. Live fuzzy search with debounced API calls, result browsing, detail view, and install action.

## Behavior

**Trigger**: `quill search` or `quill search <query>` always opens the TUI when a TTY is present. Falls back to text output when piped.

### TTY Detection

Use `std::io::IsTerminal` on `stdout()` to decide TUI vs text fallback: `stdout().is_terminal()`

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
- `i` to install (calls add command logic directly — see Install Action below)
- Esc returns to Search mode

### Fallback

When stdout is not a TTY, print the existing text table format. The `--limit` flag remains available for the text fallback path only (hidden from TUI help).

### Initial State

- When `query` is empty (e.g. `quill search` with no args), display placeholder text "Type to search..." and do not fire an API request.
- When an initial query is provided via CLI argument, populate the search input and immediately fire an API request (no debounce delay) so results appear on open.

### Error Rendering

When `error` is Some, display the error message in a highlighted bar below the search input, replacing the results list. Clear the error on the next keystroke or new successful response.

### Text Truncation

Truncate package names and descriptions to fit available column width, appending "..." when truncated.

## Architecture

Single file: `commands/search.rs` contains the full TUI app.

### App State

```rust
struct SearchApp {
    query: String,
    results: Vec<SearchResult>,
    selected: usize,
    scroll_offset: usize,
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

### Scrolling

Track `scroll_offset`. When `selected` moves below the visible area, advance the offset. When `selected` moves above, retreat. Render results from `scroll_offset` to `scroll_offset + visible_rows`. The API returns up to 20 results per call — no client-side pagination needed.

### Event Loop

1. Spawn tokio task for crossterm event reading
2. **Debounce**: on each keystroke, set `loading = true`, record `Instant::now()`. In the event loop, use `tokio::time::sleep_until(last_keystroke + 300ms)` in a `tokio::select!` branch. Cancel and re-set the timer on each new keystroke. When the debounce fires, spawn the API request.
3. On search response: set `loading = false`, update `results`, reset `selected` to 0, reset `scroll_offset` to 0
4. **Request race handling**: increment `last_request_id` on each API call. When a response arrives, only update `results` if its request_id matches `last_request_id`, discarding stale responses.
5. Render via ratatui on every event
6. Handle `TerminalResize` events: call `terminal.autoresize()` and re-render

### Terminal Handling

- Crossterm backend with ratatui
- Enter raw mode + alternate screen on start
- Restore terminal on exit (via Drop guard, even on panic)
- In raw mode, Ctrl+C arrives as a crossterm key event (`KeyEvent { code: Char('c'), modifiers: CONTROL }`), not as a SIGINT. Handle it in the key event matching logic.

### Install Action

When the user presses `i` in Detail mode:

1. If no manifest is found (running outside a project), show an error message in the TUI and remain in Detail mode.
2. Show a spinner/status message during the install (which involves network I/O and filesystem writes).
3. On success, display confirmation and return to Search mode.
4. On failure, display the error inline and remain in Detail mode.
5. The add command logic is called directly (not as a subprocess).

### Dependency Note

Cargo.toml lists `ratatui = "0.28"` and `crossterm = "0.27"`. Ratatui 0.28 requires crossterm 0.28. Bump crossterm to `"0.28"` before implementation.

## File Changes

| File | Change |
|------|--------|
| `commands/search.rs` | Rewrite: add TUI app struct, event loop, rendering |
| `cli.rs` | Change `query: String` to `query: Option<String>`. Keep `--limit` flag for text fallback. |
| `Cargo.toml` | Bump `crossterm` from `"0.27"` to `"0.28"` |

No new files.

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
