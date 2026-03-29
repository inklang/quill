# Quill Rust Rewrite Design Spec

## Overview

Full rewrite of the Quill CLI (TypeScript, ~9,700 LOC) in Rust as a single precompiled binary. Same feature set (minus deferred commands), Rust-native architecture, standard toolchain: `clap` + `tokio` + `reqwest`.

## Decisions

- **Single binary**: one `quill` executable, no Cargo workspace
- **Stack**: clap (derive), tokio, reqwest, serde, ratatui
- **Distribution**: precompiled binaries via GitHub Releases + install scripts (no Rust toolchain required for users)
- **Compiler integration**: deferred — `quill build` shells out to `printing_press` binary
- **Grammar authoring**: new `.ink-grammar` DSL parsed natively by Rust (replaces TypeScript DSL)
- **Auth**: Ed25519 keypair signing ported 1:1 (same `Ink-v1` header, same `~/.quillrc` format). Keys are PKCS8/SPKI DER-encoded (not raw Ed25519) — use `ed25519-dalek` with `pkcs8` feature flag.
- **Manifest**: strongly-typed serde structs for `ink-package.toml`
- **Architecture**: Rust-native redesign (trait-based commands, unified error enum, serde everywhere)
- **Async trait**: use `async-trait` crate for the `Command` trait to ensure `Send` bounds with tokio's multi-threaded runtime

## Scope

### In scope (v1)

| Category | Commands |
|----------|----------|
| Project | `new` |
| Dependencies | `add`, `remove` (alias: `uninstall`), `install`, `update`, `outdated`, `ls`, `why` |
| Build | `build`, `clean`, `pack` |
| Cache | `cache-info` (alias: `cache`) with subcommands: `clean`, `ls` |
| Registry | `publish`, `unpublish`, `search`, `info` |
| Auth | `login`, `logout` |
| Quality | `audit`, `doctor` |
| Meta | `completions` |

Plus: incremental build cache, transitive dependency resolution, `.ink-grammar` parser, grammar merge system, target version resolution.

### Deferred

| Command | Reason |
|---------|--------|
| `run` | Dev server orchestration — add after core stabilizes |
| `watch` | File watcher + rebuild — add alongside `run` |
| `test` | Vitest runner — revisit when Ink has native test framework |
| `setup` | Interactive server wizard — add alongside `run` |
| `check` | Grammar/runtime validation — partially folded into `build` |

Note: `build` command's deploy-to-server behavior (copying artifacts to `[server].path`) is deferred alongside `run`/`setup`.

## Project Layout

```
quill/
├── Cargo.toml
├── src/
│   ├── main.rs              # Entry point, clap setup
│   ├── cli.rs               # Clap derive structs for all commands + global opts
│   ├── error.rs             # QuillError enum, Result type alias
│   ├── context.rs           # Shared runtime context
│   ├── commands/
│   │   ├── mod.rs           # Command trait definition
│   │   ├── new.rs
│   │   ├── add.rs
│   │   ├── remove.rs
│   │   ├── install.rs
│   │   ├── update.rs
│   │   ├── build.rs
│   │   ├── publish.rs
│   │   ├── unpublish.rs
│   │   ├── login.rs
│   │   ├── logout.rs
│   │   ├── search.rs
│   │   ├── info.rs
│   │   ├── outdated.rs
│   │   ├── ls.rs
│   │   ├── why.rs
│   │   ├── clean.rs
│   │   ├── doctor.rs
│   │   ├── pack.rs
│   │   ├── audit.rs
│   │   ├── cache_info.rs    # cache-info, cache clean, cache ls
│   │   └── completions.rs
│   ├── manifest/
│   │   ├── mod.rs           # PackageManifest struct + serde
│   │   ├── toml.rs          # Read/write ink-package.toml
│   │   └── lockfile.rs      # Lockfile v2 read/write
│   ├── registry/
│   │   ├── mod.rs           # RegistryClient struct
│   │   ├── index.rs         # Index fetching + semver matching + short-name aliasing
│   │   └── auth.rs          # Ed25519 PKCS8 signing, ~/.quillrc, OAuth callback
│   ├── resolve.rs           # Transitive dependency resolution
│   ├── grammar/
│   │   ├── mod.rs           # Grammar IR types
│   │   ├── parser.rs        # .ink-grammar file parser
│   │   ├── validator.rs     # Grammar validation
│   │   ├── serializer.rs    # IR -> grammar.ir.json
│   │   └── merge.rs         # Multi-grammar merging with conflict resolution
│   ├── cache/
│   │   ├── mod.rs           # CacheManifest struct
│   │   └── dirty.rs         # File hashing, dirty detection
│   ├── audit/
│   │   ├── mod.rs
│   │   ├── osv.rs           # OSV.dev API client
│   │   ├── bytecode.rs      # .inkc bytecode safety scanner
│   │   └── checksum.rs      # sha256 verification
│   └── util/
│       ├── fs.rs            # Tar, download, dir operations
│       ├── compiler.rs      # Resolve/download printing_press binary
│       ├── semver.rs         # Semver + SemverRange
│       ├── target_version.rs # Target version resolution + compatibility checking
│       ├── using_scan.rs     # Parse "using" declarations from .ink source
│       └── ui.rs            # Spinner, colors, progress
├── tests/
│   └── fixtures/            # Test project directories
└── scripts/
    ├── install.sh           # Unix install script
    └── install.ps1          # Windows install script
```

## Core Types

### Error Handling

```rust
type Result<T> = std::result::Result<T, QuillError>;

enum QuillError {
    // File system
    ManifestNotFound { path: PathBuf },
    ManifestParse { path: PathBuf, source: toml::de::Error },
    LockfileParse { path: PathBuf, source: serde_json::Error },
    IoError { context: String, source: std::io::Error },

    // Registry
    RegistryRequest { url: String, source: reqwest::Error },
    RegistryAuth { message: String },
    PackageNotFound { name: String, version: Option<String> },

    // Dependencies
    ResolutionConflict { package: String, ranges: Vec<String> },
    CircularDependency { chain: Vec<String> },
    ChecksumMismatch { package: String, expected: String, actual: String },

    // Build
    CompilerNotFound,
    CompilerFailed { script: String, stderr: String },
    GrammarParse { path: PathBuf, message: String, line: usize, col: usize },
    GrammarValidation { errors: Vec<String> },

    // Auth
    NotLoggedIn,
    LoginFailed { message: String },

    // Audit
    VulnerabilitiesFound { count: usize },
    UnsafeBytecode { script: String, operations: Vec<String> },

    // Target version
    TargetVersionIncompatible { package: String, message: String },

    // General
    UserCancelled,
}
```

### Context

```rust
struct Context {
    project_dir: PathBuf,
    manifest: Option<PackageManifest>,
    registry_url: String,
    rc: Option<QuillRc>,
    verbose: bool,
    quiet: bool,
}
```

### Command Trait

```rust
#[async_trait]
trait Command {
    async fn execute(&self, ctx: &Context) -> Result<()>;
}
```

Uses `async-trait` crate to ensure `Send` bounds for tokio's multi-threaded runtime.

### Global CLI Options

```rust
#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
    #[arg(short, long, global = true)]
    verbose: bool,
    #[arg(short, long, global = true)]
    quiet: bool,
}
```

## Command Options

Key per-command flags for compatibility:

| Command | Flags |
|---------|-------|
| `add` | `--force`, `--yes`, `--save-exact`, `--dry-run` |
| `remove` | (alias: `uninstall`) |
| `install` | `--dry-run`, `--target-version <range>` |
| `build` | `-F`/`--full`, `--target-version <range>` |
| `new` | `--package <name>`, `--template <tpl>`, `--type <script\|library>` |
| `search` | `--page <n>`, `--json` |
| `info` | `--version <ver>`, `--json` |
| `ls` | `--json` |
| `outdated` | `--json` |
| `doctor` | `--json` |
| `audit` | `--json`, `--offline` |
| `login` | `--token <token>`, `--username <user>` (CI mode) |

## Manifest & Lockfile

### PackageManifest (ink-package.toml)

```rust
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
struct PackageInfo {
    name: String,
    version: String,
    #[serde(rename = "type")]
    package_type: Option<PackageType>,
    description: Option<String>,
    author: Option<String>,
    homepage: Option<String>,
    repository: Option<String>,
    main: Option<String>,
    target: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct PackageManifest {
    package: PackageInfo,
    #[serde(default)]
    dependencies: BTreeMap<String, String>,
    grammar: Option<GrammarConfig>,
    build: Option<BuildConfig>,
    runtime: Option<RuntimeConfig>,
    server: Option<ServerConfig>,
    #[serde(default)]
    targets: BTreeMap<String, TargetConfig>,
}

#[derive(Deserialize, Serialize)]
struct GrammarConfig { entry: String, output: String }

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
struct BuildConfig {
    entry: Option<String>,
    compiler: Option<String>,
    target: Option<String>,
    target_version: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
struct TargetConfig {
    entry: Option<String>,
    jar: Option<String>,
    jvm_args: Option<Vec<String>>,
    env: Option<BTreeMap<String, String>>,
    target_version: Option<String>,
}
```

### Lockfile (quill.lock, JSON v2)

```rust
#[derive(Deserialize, Serialize)]
struct Lockfile {
    version: u32,
    registry: String,
    packages: BTreeMap<String, LockedPackage>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LockedPackage {
    version: String,
    resolution_source: String,
    dependencies: Vec<String>,
}
```

BTreeMap for deterministic ordering (no noisy lockfile diffs).

## Registry Client & Auth

### RegistryClient

```rust
struct RegistryClient {
    client: reqwest::Client,
    base_url: String,
}

impl RegistryClient {
    fn new(base_url: &str) -> Self;
    async fn fetch_index(&self) -> Result<RegistryIndex>;
    fn find_best_match(index: &RegistryIndex, name: &str, range: &SemverRange)
        -> Option<&RegistryPackageVersion>;
    async fn search(&self, query: &str) -> Result<Vec<SearchResult>>;
    async fn get_package_info(&self, name: &str, version: Option<&str>) -> Result<PackageInfo>;
    async fn publish(&self, name: &str, version: &str, tarball: &Path,
                     description: &str, readme: Option<&str>,
                     targets: Option<&[String]>, auth: &AuthContext) -> Result<()>;
    async fn unpublish(&self, name: &str, version: &str, auth: &AuthContext) -> Result<()>;
    async fn download_package(&self, url: &str, dest: &Path) -> Result<()>;
    async fn validate_auth(&self, auth: &AuthContext) -> Result<bool>;
}
```

### Registry Index & Short-Name Aliasing

```rust
struct RegistryIndex {
    packages: BTreeMap<String, BTreeMap<String, RegistryPackageVersion>>,
}

impl RegistryIndex {
    /// Look up by full name or short name (part after `/`).
    /// e.g., "ink.paper" matches "@scope/ink.paper".
    fn get(&self, name: &str) -> Option<&BTreeMap<String, RegistryPackageVersion>>;
}

struct RegistryPackageVersion {
    version: String,
    url: String,
    dependencies: BTreeMap<String, String>,
    description: Option<String>,
    homepage: Option<String>,
    targets: Option<Vec<String>>,
    checksum: Option<String>,
    package_type: String,
}

struct SearchResult {
    name: String,
    version: String,
    description: String,
    score: f64,
    package_type: String,
}
```

### Publish Wire Protocol

Publish uses a raw gzip body with metadata in custom headers (not multipart form):

```
PUT /api/packages/{name}/{version}
Content-Type: application/vnd.ink-publish+gzip
Authorization: Ink-v1 keyId=...,ts=...,sig=...
X-Package-Type: script
X-Package-Description: ...
X-Package-Readme: ...           (optional, base64-encoded)
X-Package-Targets: ["paper"]    (optional, JSON array)

<raw gzip body>
```

### Auth (Ed25519 with PKCS8/SPKI DER)

The existing auth system uses PKCS8 DER-encoded private keys and SPKI DER-encoded public keys (generated by Node's `crypto.generateKeyPairSync('ed25519')`). The `keyId` is `sha256(spkiDerBytes)[:32]` hex.

```rust
struct QuillRc {
    key_id: String,         // sha256(SPKI DER)[:32] hex
    private_key: String,    // PKCS8 DER, base64-encoded
    username: String,
    registry: String,
}

struct AuthContext {
    key_id: String,
    signing_key: SigningKey,  // ed25519-dalek with pkcs8 feature
}

impl AuthContext {
    /// Decode PKCS8 DER base64 → SigningKey via pkcs8::DecodePrivateKey
    fn from_rc(rc: &QuillRc) -> Result<Self>;
    fn make_auth_header(&self) -> String;  // "Ink-v1 keyId=...,ts=...,sig=..."
}
```

Use `ed25519-dalek` with `pkcs8` feature enabled. `SigningKey::from_pkcs8_der()` handles the DER unwrapping. New keypair generation also produces PKCS8/SPKI DER to maintain compatibility with the existing Lectern registry.

Login flow:
1. Generate Ed25519 keypair, encode as PKCS8 DER (private) + SPKI DER (public)
2. Spawn `tokio::net::TcpListener` on random port for OAuth callback
3. Open browser to `{registry}/cli-auth?callback=http://127.0.0.1:{port}/callback`
4. Receive token + username on callback
5. POST public key (SPKI DER base64) to registry
6. Write `~/.quillrc` (0o600 permissions)

CI path: `quill login --token <token> --username <user>` skips the browser.

## Dependency Resolution

```rust
struct ResolvedPackage {
    name: String,
    version: Semver,
    url: String,
    range: String,
    targets: Option<Vec<String>>,
    checksum: Option<String>,
    dep_keys: Vec<String>,
}

fn resolve_transitive(
    index: &RegistryIndex,
    roots: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, ResolvedPackage>>;
```

Cycle detection via `HashSet<String>` visiting set. Conflict detection when multiple parents require incompatible ranges.

## Build Pipeline

`quill build` steps:

1. Load manifest, resolve active target
2. **Target version resolution**: resolve from CLI flag > `build.target-version` > `server.paper` (paper target only). Check all dependency manifests for target version compatibility — warn or error on mismatches.
3. **Grammar compilation**: if `.ink-grammar` entry exists, parse and validate it, serialize to `grammar.ir.json`
4. **Grammar merge**: scan `.ink` source files for `using` declarations, resolve referenced package grammars from installed packages, merge into base grammar IR via `merge_grammars()` (handles alias conflicts, keyword renaming, cross-package rule ownership)
5. Check build cache, find dirty `.ink` files (hash comparison)
6. Shell out to `printing_press compile` for each dirty file
7. Write `ink-manifest.json`
8. Update cache manifest

### Target Version Resolution

```rust
/// Priority: CLI flag > build.target-version > server.paper (paper target only)
fn resolve_target_version(
    cli_flag: Option<&str>,
    build_config: Option<&BuildConfig>,
    server_config: Option<&ServerConfig>,
    target: &str,
) -> Option<SemverRange>;

/// Check all deps support the active target + version
fn check_target_version_compatibility(
    manifest: &PackageManifest,
    dep_manifests: &[PackageManifest],
    target: &str,
    target_version: &SemverRange,
) -> Vec<VersionIssue>;

struct VersionIssue {
    level: IssueLevel,  // Warn | Error
    package: String,
    message: String,
}
```

### Grammar Merge

```rust
/// Scan .ink files for "using <package> [as <alias>]" declarations
fn scan_using_declarations(source: &str) -> Vec<UsingDecl>;

struct UsingDecl {
    package: String,
    alias: Option<String>,
}

/// Merge base grammar with package grammars, resolving conflicts
fn merge_grammars(
    base: &GrammarIr,
    packages: &[(String, GrammarIr)],  // (alias, grammar)
) -> Result<GrammarIr>;
```

Merge handles: keyword conflicts (error if two packages define the same keyword), alias-based namespacing, and rule deduplication.

## Semver

```rust
#[derive(Debug, Clone, Ord, PartialOrd, Eq, PartialEq)]
struct Semver { major: u32, minor: u32, patch: u32 }

enum SemverRange {
    Any,                        // "*" — matches all versions
    Exact(Semver),              // "1.2.3"
    Caret(Semver),              // "^1.2.3" — >=1.2.3 <2.0.0
    Tilde(Semver),              // "~1.2.3" — >=1.2.3 <1.3.0
    Gte(Semver),                // ">=1.2.3"
    Lt(Semver),                 // "<2.0.0"
    Compound(Vec<SemverRange>), // ">=1.20 <1.23"
}

impl SemverRange {
    fn parse(input: &str) -> Result<Self>;
    fn matches(&self, version: &Semver) -> bool;
}
```

`Any` variant handles `*` wildcard used by `quill add <pkg>` when no version is specified.

## Build Cache

```rust
#[derive(Deserialize, Serialize)]
struct CacheManifest {
    version: u32,
    last_full_build: String,
    grammar_ir_hash: Option<String>,
    runtime_jar_hash: Option<String>,
    entries: BTreeMap<String, CacheEntry>,
}

#[derive(Deserialize, Serialize)]
struct CacheEntry {
    hash: String,
    output: String,
    compiled_at: String,
}

fn find_dirty_files(project_dir: &Path, cache: &CacheManifest, full: bool) -> Vec<PathBuf>;
fn hash_file(path: &Path) -> Result<String>;
```

## Audit

```rust
struct OsvClient { client: reqwest::Client }

impl OsvClient {
    async fn scan(&self, package: &str, version: &str) -> Result<Vec<Vulnerability>>;
}

struct Vulnerability {
    id: String,
    summary: String,
    severity: Option<Severity>,
    references: Vec<String>,
}

enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

fn verify_checksum(file: &Path, expected: &str) -> Result<()>;
```

### Bytecode Scanner

Inspects compiled `.inkc` bytecode for disallowed operations:

```rust
struct BytecodeScanner;

/// Disallowed operations in published packages
const DISALLOWED_OPS: &[&str] = &[
    "FILE_READ", "FILE_WRITE", "HTTP_REQUEST", "EXEC", "EVAL", "DB_WRITE",
];

impl BytecodeScanner {
    fn scan(inkc_path: &Path) -> Result<Vec<BytecodeViolation>>;
}

struct BytecodeViolation {
    operation: String,
    location: String,
}
```

Used by `quill audit` and optionally during `quill publish` to prevent unsafe packages.

## Grammar DSL (.ink-grammar)

### Syntax

```
grammar <package-name>

declare <keyword> [inherits base] {
    <rule-name> = <pattern> [-> <handler>]
}
```

### Pattern expressions

| Syntax | Meaning |
|--------|---------|
| `keyword_name` | Matches a keyword token |
| `<ident>` | Matches an identifier |
| `<int>` | Matches an integer literal |
| `<float>` | Matches a float literal |
| `<string>` | Matches a string literal |
| `"literal"` | Matches an exact literal string |
| `{ ... }` | Matches a block (scope) |
| `( a \| b \| c )` | Choice between alternatives |
| `a b c` | Sequence (whitespace-separated) |
| `a*` | Zero or more |
| `a+` | One or more |
| `a?` | Optional |

### Example

```
grammar ink.paper

declare mob inherits base {
    on_spawn_clause    = on_spawn { ... }
    on_death_clause    = on_death { ... }
    on_damage_clause   = on_damage { ... }
    on_tick_clause     = on_tick { ... }
    on_target_clause   = on_target { ... }
    on_interact_clause = on_interact { ... }
}

declare command inherits base {
    on_execute_clause  = on_execute { ... }                            -> on_execute
    command_clause     = { ... }                                       -> on_execute
    permission_clause  = permission <string>                           -> permission
    alias_clause       = alias <string>                                -> alias
}

declare config inherits base {
    file_clause         = file <string>                                -> file
    config_entry_clause = <ident> ":" (<string> | <int> | <float> | true | false) -> config_entry
}
```

The parser is recursive descent, producing the same `GrammarPackage` IR JSON that ink-bukkit consumes.

## UI Strategy

### Ratatui (interactive TUI)

- `quill new` — project scaffold wizard
- `quill search` — browsable results with detail preview
- `quill doctor` — live diagnostic checklist
- `quill audit` — vulnerability results with expandable details
- `quill login` — status/progress while waiting for browser callback

### Plain stdout

- `quill add`, `remove`, `install`, `update` — progress spinner, done
- `quill build` — compile progress, errors
- `quill publish`, `unpublish` — confirmation + result
- `quill info`, `ls`, `why`, `outdated` — print and exit
- `quill clean`, `logout`, `completions`, `pack` — one-shot output

## Dependencies

| Crate | Purpose |
|-------|---------|
| `clap` (derive) | CLI parsing |
| `tokio` | Async runtime |
| `reqwest` | HTTP client |
| `serde` + `serde_json` | JSON serialization |
| `toml` | TOML parsing |
| `ed25519-dalek` (with `pkcs8` feature) | Ed25519 signing with PKCS8 DER support |
| `sha2` | SHA-256 hashing |
| `flate2` + `tar` | Tar.gz pack/extract |
| `open` | Open browser for login |
| `ratatui` + `crossterm` | Interactive TUI flows |
| `indicatif` | Simple progress spinners |
| `async-trait` | Async fn in Command trait |
| `base64` | Key encoding |

## Distribution

- Precompiled binaries for: `x86_64-linux`, `x86_64-windows`, `aarch64-macos`, `x86_64-macos`
- GitHub Actions CI builds on release tags
- `install.sh` (Unix) / `install.ps1` (Windows) — detect platform, download binary, install to `~/.quill/bin/`, add to PATH
- No Rust toolchain required for end users

## Migration

- Existing `~/.quillrc` files work as-is (same JSON format, same PKCS8/SPKI DER key encoding)
- Existing `quill.lock` files work as-is (same JSON v2 format)
- Existing `ink-package.toml` files work as-is (same TOML schema)
- Grammar files need migration from `.ts` to `.ink-grammar` (one-time, manual)
- `grammar.ir.json` output is identical — ink-bukkit needs no changes
