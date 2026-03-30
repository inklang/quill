# Quill Search TUI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text-table `quill search` with an interactive ratatui TUI featuring live search, detail view, and install action.

**Architecture:** Single-file TUI app in `commands/search.rs`. Crossterm backend with ratatui rendering. Async event loop with tokio, debounced API calls via `JoinHandle::abort()`, and two modes (Search + Detail). Falls back to text output when not a TTY.

**Tech Stack:** Rust, ratatui 0.28, crossterm 0.28, tokio, clap

**Spec:** `docs/superpowers/specs/2026-03-29-quill-search-tui-design.md`

---

## Chunk 1: CLI + Dependency Setup

### Task 1: Bump crossterm and make query optional in CLI

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/cli.rs`
- Modify: `src/commands/mod.rs`
- Modify: `src/commands/search.rs`

- [ ] **Step 1: Bump crossterm to 0.28 in Cargo.toml**

Change `crossterm = "0.27"` to `crossterm = "0.28"`.

- [ ] **Step 2: Make query optional in cli.rs**

In the `Search` variant of `Commands` enum, change `query: String` to `query: Option<String>`:

```rust
/// Search registry
Search {
    query: Option<String>,

    #[arg(short, long)]
    limit: Option<usize>,
},
```

- [ ] **Step 3: Update dispatch in commands/mod.rs**

The dispatch already passes `query.clone()` — with `Option<String>` this works unchanged. No edit needed.

- [ ] **Step 4: Update Search struct in search.rs**

Change the struct to accept `Option<String>`:

```rust
pub struct Search {
    pub query: Option<String>,
    pub limit: Option<usize>,
}
```

Update the `execute` method to handle `Option<String>` — change `&self.query` to `self.query.as_deref().unwrap_or("")` in the existing text output code.

- [ ] **Step 5: Build to verify compilation**

Run: `cargo build`
Expected: Compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml src/cli.rs src/commands/search.rs
git commit -m "chore(search): bump crossterm 0.28, make query optional"
```

---

## Chunk 2: TUI App State, Terminal Guard, Rendering, and Full Event Loop

### Task 2: Write the complete TUI search command

**Files:**
- Rewrite: `src/commands/search.rs`

This task creates the entire file in one shot: imports, app state with `Cell<u64>` for `last_request_id`, terminal guard, rendering, event loop with proper debounce via `JoinHandle::abort()`, detail mode, and install action. No intermediate broken states.

**Key design decisions incorporated from plan review:**
- `text_search` is async (no `block_on` inside an async runtime)
- `trigger_debounced_search` stores a `JoinHandle` and calls `.abort()` on the previous handle before spawning a new one — true debouncing, not request spraying
- `Cell<u64>` for `last_request_id` avoids borrow conflicts
- `loading` is set to `true` inside `trigger_debounced_search`
- `j`/`k` omitted from Search mode (conflicts with text input)
- Install success returns to Search mode
- `run_install` sets `ctx.registry_url` explicitly

- [ ] **Step 1: Replace the entire contents of `src/commands/search.rs`**

```rust
use std::cell::Cell;
use std::io::{self, IsTerminal, Stdout};
use std::path::Path;

use async_trait::async_trait;
use crossterm::{
    event::{self, Event, KeyCode, KeyEvent, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style, Stylize},
    text::{Line, Span},
    widgets::{
        Block, Borders, Clear, HighlightSpacing, List, ListItem, ListState, Paragraph,
    },
    Frame, Terminal,
};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;
use crate::registry::index::SearchResult;
use crate::registry::RegistryClient;

// ── App State ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
enum Mode {
    Search,
    Detail,
}

#[derive(Debug, Clone, Default)]
struct InstallState {
    installing: bool,
    message: Option<String>,
    success: bool,
}

struct SearchApp {
    query: String,
    results: Vec<SearchResult>,
    selected: usize,
    scroll_offset: usize,
    mode: Mode,
    loading: bool,
    error: Option<String>,
    last_request_id: Cell<u64>,
    install_state: InstallState,
    pending_search: Option<JoinHandle<()>>,
}

impl SearchApp {
    fn new(initial_query: Option<String>) -> Self {
        Self {
            query: initial_query.unwrap_or_default(),
            results: Vec::new(),
            selected: 0,
            scroll_offset: 0,
            mode: Mode::Search,
            loading: false,
            error: None,
            last_request_id: Cell::new(0),
            install_state: InstallState::default(),
            pending_search: None,
        }
    }

    fn selected_package(&self) -> Option<&SearchResult> {
        self.results.get(self.selected)
    }

    fn update_scroll(&mut self, visible_rows: usize) {
        if self.selected < self.scroll_offset {
            self.scroll_offset = self.selected;
        } else if self.selected >= self.scroll_offset + visible_rows {
            self.scroll_offset = self.selected - visible_rows + 1;
        }
    }
}

// ── Terminal Guard ─────────────────────────────────────────────────

struct TuiGuard {
    terminal: Terminal<CrosstermBackend<Stdout>>,
}

impl TuiGuard {
    fn new() -> io::Result<Self> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen)?;
        let backend = CrosstermBackend::new(stdout);
        let terminal = Terminal::new(backend)?;
        Ok(Self { terminal })
    }
}

impl Drop for TuiGuard {
    fn drop(&mut self) {
        execute!(self.terminal.backend_mut(), LeaveAlternateScreen)
            .unwrap_or(());
        disable_raw_mode().unwrap_or(());
    }
}

// ── Events ─────────────────────────────────────────────────────────

enum AppEvent {
    Key(KeyEvent),
    Resize,
    SearchResults { id: u64, results: Vec<SearchResult> },
    SearchError { id: u64, error: String },
    InstallComplete { success: bool, message: String },
}

// ── Command Impl ───────────────────────────────────────────────────

pub struct Search {
    pub query: Option<String>,
    pub limit: Option<usize>,
}

#[async_trait]
impl Command for Search {
    async fn execute(&self, ctx: &Context) -> Result<()> {
        let client = RegistryClient::new(&ctx.registry_url);

        // Non-TTY fallback: print text table
        if !io::stdout().is_terminal() {
            return text_search(
                self.query.as_deref().unwrap_or(""),
                self.limit,
                &client,
            )
            .await;
        }

        // TTY: launch TUI
        let mut guard = TuiGuard::new()
            .map_err(|e| crate::error::QuillError::io_error("terminal setup", e))?;
        let mut app = SearchApp::new(self.query.clone());

        let (tx, mut rx) = mpsc::channel::<AppEvent>(100);

        // Crossterm event reader task
        let tx_key = tx.clone();
        tokio::spawn(async move {
            loop {
                if event::poll(std::time::Duration::from_millis(50)).unwrap_or(false) {
                    match event::read() {
                        Ok(Event::Key(key)) => {
                            if tx_key.send(AppEvent::Key(key)).await.is_err() {
                                break;
                            }
                        }
                        Ok(Event::Resize(_, _)) => {
                            if tx_key.send(AppEvent::Resize).await.is_err() {
                                break;
                            }
                        }
                        _ => {}
                    }
                }
            }
        });

        // Fire initial search if query provided (no debounce)
        if !app.query.is_empty() {
            let id = next_request_id(&app);
            let tx_search = tx.clone();
            let client = client.clone();
            let query = app.query.clone();
            let handle = tokio::spawn(async move {
                fire_search(client, query, id, tx_search).await;
            });
            app.pending_search = Some(handle);
            app.loading = true;
        }

        // ── Main Event Loop ────────────────────────────────────────
        loop {
            guard
                .terminal
                .draw(|f| render(f, &app))
                .map_err(|e| crate::error::QuillError::io_error("render", e))?;

            let Some(event) = rx.recv().await else {
                break;
            };

            match event {
                AppEvent::Resize => {
                    let _ = guard.terminal.autoresize();
                }

                AppEvent::Key(key) => {
                    // Global: Ctrl+C always quits
                    if key.modifiers.contains(KeyModifiers::CONTROL)
                        && key.code == KeyCode::Char('c')
                    {
                        break;
                    }

                    match app.mode {
                        Mode::Search => handle_search_key(&mut app, key, &client, &tx, &guard),
                        Mode::Detail => handle_detail_key(&mut app, key, ctx, &tx),
                    }
                }

                AppEvent::SearchResults { id, results } => {
                    if id == app.last_request_id.get() {
                        app.loading = false;
                        app.error = None;
                        app.results = results;
                        app.selected = 0;
                        app.scroll_offset = 0;
                    }
                }

                AppEvent::SearchError { id, error } => {
                    if id == app.last_request_id.get() {
                        app.loading = false;
                        app.error = Some(error);
                        app.results.clear();
                        app.selected = 0;
                        app.scroll_offset = 0;
                    }
                }

                AppEvent::InstallComplete { success, message } => {
                    app.install_state = InstallState {
                        installing: false,
                        message: Some(message),
                        success,
                    };
                    if success {
                        app.mode = Mode::Search;
                    }
                }
            }
        }

        Ok(())
    }
}

// ── Key Handlers ───────────────────────────────────────────────────

fn handle_search_key(
    app: &mut SearchApp,
    key: KeyEvent,
    client: &RegistryClient,
    tx: &mpsc::Sender<AppEvent>,
    guard: &TuiGuard,
) {
    match key.code {
        KeyCode::Esc => {
            // Esc in Search mode = quit (handled by returning; caller breaks loop)
            // We set a flag or the caller checks. Actually the caller matches on
            // Esc and breaks — but we're inside a function now. Use a return value.
            // Simplest: just call std::process::exit(0) — no, that skips Drop.
            // Instead, we'll use a sentinel: set mode to a quit variant.
            // Actually, the cleanest fix: don't extract key handling into a function.
            // Keep the match inline in execute. But for readability...
            // We'll handle Esc in the caller by checking the key before dispatching.
            // For now, this function doesn't handle Esc — the caller does.
        }
        KeyCode::Char(c) => {
            app.query.push(c);
            app.error = None;
            trigger_debounced_search(app, client, tx);
        }
        KeyCode::Backspace => {
            app.query.pop();
            app.error = None;
            trigger_debounced_search(app, client, tx);
        }
        KeyCode::Up => {
            if app.selected > 0 {
                app.selected -= 1;
            }
            app.update_scroll(visible_rows(&guard.terminal));
        }
        KeyCode::Down => {
            if !app.results.is_empty() && app.selected < app.results.len() - 1 {
                app.selected += 1;
            }
            app.update_scroll(visible_rows(&guard.terminal));
        }
        KeyCode::Enter => {
            if app.selected_package().is_some() {
                app.mode = Mode::Detail;
                app.install_state = InstallState::default();
            }
        }
        _ => {}
    }
}

fn handle_detail_key(
    app: &mut SearchApp,
    key: KeyEvent,
    ctx: &Context,
    tx: &mpsc::Sender<AppEvent>,
) {
    match key.code {
        KeyCode::Esc => {
            app.mode = Mode::Search;
        }
        KeyCode::Char('i') => {
            if !app.install_state.installing {
                if let Some(pkg) = app.selected_package().cloned() {
                    app.install_state.installing = true;
                    let tx_install = tx.clone();
                    let project_dir = ctx.project_dir.clone();
                    let registry_url = ctx.registry_url.clone();
                    tokio::spawn(async move {
                        let result = run_install(&pkg.name, &project_dir, &registry_url).await;
                        match result {
                            Ok(()) => {
                                let _ = tx_install
                                    .send(AppEvent::InstallComplete {
                                        success: true,
                                        message: format!("Installed {} successfully!", pkg.name),
                                    })
                                    .await;
                            }
                            Err(e) => {
                                let _ = tx_install
                                    .send(AppEvent::InstallComplete {
                                        success: false,
                                        message: e.to_string(),
                                    })
                                    .await;
                            }
                        }
                    });
                }
            }
        }
        _ => {}
    }
}

// ── Debounced Search ───────────────────────────────────────────────

fn trigger_debounced_search(
    app: &mut SearchApp,
    client: &RegistryClient,
    tx: &mpsc::Sender<AppEvent>,
) {
    if app.query.is_empty() {
        app.results.clear();
        app.selected = 0;
        app.scroll_offset = 0;
        app.loading = false;
        return;
    }

    // Abort previous pending search (true debounce)
    if let Some(handle) = app.pending_search.take() {
        handle.abort();
    }

    let id = next_request_id(app);
    app.loading = true;

    let tx = tx.clone();
    let client = client.clone();
    let query = app.query.clone();

    let handle = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        fire_search(client, query, id, tx).await;
    });

    app.pending_search = Some(handle);
}

fn next_request_id(app: &SearchApp) -> u64 {
    let id = app.last_request_id.get() + 1;
    app.last_request_id.set(id);
    id
}

async fn fire_search(
    client: RegistryClient,
    query: String,
    id: u64,
    tx: mpsc::Sender<AppEvent>,
) {
    match client.search(&query).await {
        Ok(results) => {
            let _ = tx.send(AppEvent::SearchResults { id, results }).await;
        }
        Err(e) => {
            let _ = tx
                .send(AppEvent::SearchError {
                    id,
                    error: e.to_string(),
                })
                .await;
        }
    }
}

// ── Install ────────────────────────────────────────────────────────

async fn run_install(
    package_name: &str,
    project_dir: &Path,
    registry_url: &str,
) -> Result<()> {
    use crate::commands::add::Add;

    let mut ctx = Context::new(project_dir.to_path_buf(), false, false);
    ctx.registry_url = registry_url.to_string();
    ctx.load_manifest()?;

    let add = Add {
        version: None,
        registry: Some(registry_url.to_string()),
        packages: vec![package_name.to_string()],
    };

    add.execute(&ctx).await
}

// ── Text Fallback (async) ──────────────────────────────────────────

async fn text_search(
    query: &str,
    limit: Option<usize>,
    client: &RegistryClient,
) -> Result<()> {
    let results = client.search(query).await?;
    let limit = limit.unwrap_or(results.len());

    if results.is_empty() {
        println!("No packages found matching '{}'", query);
    } else {
        println!("Search results for '{}':", query);
        println!("{:<30} {:<10} {:<40}", "Name", "Version", "Description");
        println!("{}", "-".repeat(80));

        for result in results.iter().take(limit) {
            let description: String = result.description.chars().take(37).collect();
            println!(
                "{:<30} {:<10} {:.<40}",
                result.name, result.version, description
            );
        }

        println!("\n{} packages found", results.len());
    }

    Ok(())
}

// ── Rendering ──────────────────────────────────────────────────────

fn render(f: &mut Frame, app: &SearchApp) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(1)])
        .split(f.area());

    render_search_bar(f, app, chunks[0]);
    match app.mode {
        Mode::Search => render_results(f, app, chunks[1]),
        Mode::Detail => render_detail(f, app, chunks[1]),
    }
}

fn render_search_bar(f: &mut Frame, app: &SearchApp, area: Rect) {
    let style = Style::default();
    let input = Paragraph::new(Line::from(vec![
        Span::styled(" Search: ", style.bold().fg(Color::Cyan)),
        Span::styled(&app.query, style.fg(Color::White)),
        Span::styled("█", style.fg(Color::Cyan)),
    ]))
    .block(Block::default().borders(Borders::BOTTOM).style(style));

    f.render_widget(input, area);
}

fn render_results(f: &mut Frame, app: &SearchApp, area: Rect) {
    if app.loading && app.results.is_empty() {
        let loading = Paragraph::new("  Searching...")
            .style(Style::default().fg(Color::Yellow));
        f.render_widget(loading, area);
        return;
    }

    if let Some(ref err) = app.error {
        let error = Paragraph::new(format!("  Error: {}", err))
            .style(Style::default().fg(Color::Red));
        f.render_widget(error, area);
        return;
    }

    if app.results.is_empty() {
        let msg = if app.query.is_empty() {
            "  Type to search..."
        } else {
            "  No results found"
        };
        let placeholder = Paragraph::new(msg).style(Style::default().fg(Color::DarkGray));
        f.render_widget(placeholder, area);
        return;
    }

    let visible_count = area.height.saturating_sub(2) as usize;
    let name_width: usize = 25;
    let ver_width: usize = 10;

    let visible: Vec<ListItem> = app
        .results
        .iter()
        .skip(app.scroll_offset)
        .take(visible_count)
        .map(|r| {
            let desc_width = area
                .width
                .saturating_sub(name_width as u16 + ver_width as u16 + 6) as usize;
            let name = truncate(&r.name, name_width);
            let ver = truncate(&r.version, ver_width);
            let desc = truncate(&r.description, desc_width);

            ListItem::new(Line::from(vec![
                Span::styled(
                    format!("  {:name_width$}", name),
                    Style::default().fg(Color::Green).bold(),
                ),
                Span::styled(
                    format!(" {:ver_width$}", ver),
                    Style::default().fg(Color::Yellow),
                ),
                Span::raw(" "),
                Span::styled(desc, Style::default().fg(Color::Gray)),
            ]))
        })
        .collect();

    let list = List::new(visible)
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_spacing(HighlightSpacing::Always);

    let mut state = ListState::default();
    let visible_selected = app.selected.saturating_sub(app.scroll_offset);
    state.select(Some(visible_selected));

    f.render_stateful_widget(list, area, &mut state);
}

fn render_detail(f: &mut Frame, app: &SearchApp, area: Rect) {
    let Some(pkg) = app.selected_package() else {
        return;
    };

    let card = Rect {
        x: area.x + area.width.saturating_sub(60) / 2,
        y: area.y + area.height.saturating_sub(14) / 2,
        width: 60.min(area.width),
        height: 14.min(area.height),
    };

    f.render_widget(Clear, card);

    let desc_max = card.width.saturating_sub(4) as usize;
    let desc = truncate(&pkg.description, desc_max);

    let lines = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(&pkg.name, Style::default().fg(Color::Green).bold()),
        ]),
        Line::from(vec![
            Span::styled("  Version: ", Style::default().fg(Color::DarkGray)),
            Span::styled(&pkg.version, Style::default().fg(Color::Yellow)),
        ]),
        Line::from(vec![
            Span::styled("  Type: ", Style::default().fg(Color::DarkGray)),
            Span::raw(&pkg.package_type),
        ]),
        Line::from(vec![
            Span::styled("  Score: ", Style::default().fg(Color::DarkGray)),
            Span::raw(format!("{:.2}", pkg.score)),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(desc, Style::default().fg(Color::Gray)),
        ]),
        Line::from(""),
    ];

    let detail = Paragraph::new(lines).block(
        Block::default()
            .borders(Borders::ALL)
            .title(" Package Detail "),
    );

    f.render_widget(detail, card);

    let hint_area = Rect {
        x: card.x,
        y: card.y + card.height,
        width: card.width,
        height: 1,
    };

    let hint = if app.install_state.installing {
        Line::from(vec![Span::styled(
            "  Installing...",
            Style::default().fg(Color::Yellow),
        )])
    } else if let Some(ref msg) = app.install_state.message {
        let color = if app.install_state.success {
            Color::Green
        } else {
            Color::Red
        };
        Line::from(vec![Span::styled(
            format!("  {}", msg),
            Style::default().fg(color),
        )])
    } else {
        Line::from(vec![
            Span::styled("  Press ", Style::default().fg(Color::DarkGray)),
            Span::styled("i", Style::default().fg(Color::Cyan).bold()),
            Span::styled(" to install  |  ", Style::default().fg(Color::DarkGray)),
            Span::styled("Esc", Style::default().fg(Color::Cyan).bold()),
            Span::styled(" to go back", Style::default().fg(Color::DarkGray)),
        ])
    };

    f.render_widget(Paragraph::new(hint), hint_area);
}

// ── Helpers ────────────────────────────────────────────────────────

fn visible_rows(terminal: &Terminal<CrosstermBackend<Stdout>>) -> usize {
    let area = terminal.size().unwrap_or(Rect::default());
    area.height.saturating_sub(5) as usize
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max.saturating_sub(3)).collect();
        format!("{}...", truncated)
    }
}
```

Note: The `handle_search_key` function doesn't handle `Esc` for quitting. That's handled in the main event loop — add an `Esc` check before calling `handle_search_key`:

In the main `AppEvent::Key` match arm for `Mode::Search`:

```rust
Mode::Search => {
    if key.code == KeyCode::Esc {
        break;
    }
    handle_search_key(&mut app, key, &client, &tx, &guard);
}
```

Make sure the main loop's `Mode::Search` dispatch looks like the above.

- [ ] **Step 2: Build and fix any compilation errors**

Run: `cargo build`
Expected: Compiles successfully. Fix any issues before proceeding.

- [ ] **Step 3: Manual smoke test**

Run: `cargo run -- search`
Expected: TUI opens with empty search, "Type to search..." shown. Type characters — after 300ms pause, results load. Navigate with arrows. Enter opens detail. `i` triggers install. Esc from detail goes back to search. Esc from search or Ctrl+C quits.

- [ ] **Step 4: Test text fallback**

Run: `cargo run -- search ink | cat`
Expected: Text table output.

- [ ] **Step 5: Commit**

```bash
git add src/commands/search.rs
git commit -m "feat(search): implement interactive TUI with live search, detail view, and install"
```

---

## Chunk 3: Final Verification

### Task 3: Release build and final check

- [ ] **Step 1: Clean release build**

Run: `cargo build --release`
Expected: Clean build with no errors or warnings.

- [ ] **Step 2: Commit any remaining fixes**
