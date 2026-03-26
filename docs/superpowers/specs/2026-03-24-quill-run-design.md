# Design: quill run — Managed Dev Server

**Date:** 2026-03-24

## Problem

After building `.inkc` scripts with `quill build`, there is no way to run them without manually managing a Paper server, copying files, and restarting. `quill run` should be a single command that handles the entire dev loop.

## Command Interface

```bash
quill run                # full dev loop: setup → build → deploy → serve → watch
quill run --no-watch     # build + deploy + start server, no file watching
```

`quill run` is a project command — enforced by the existing `requireProject()` guard.

### `[server]` section in `ink-package.toml`

```toml
[server]
paper = "1.21.4"                  # Minecraft/Paper version (default: "1.21.4")
jar = "path/to/paper-1.21.4.jar"  # use existing JAR instead of downloading; always resolved relative to project root
path = "/custom/server/dir"       # override default server directory; absolute or relative to project root
```

All fields are optional. `jar` takes precedence over `paper` if both are set. `server.jar` is always resolved relative to the project root (directory containing `ink-package.toml`), regardless of `server.path`.

## Type Changes

### `src/model/manifest.ts`

Add:

```ts
export interface ServerConfig {
  paper?: string   // Minecraft version string, e.g. "1.21.4" (used as Paper project version)
  jar?: string     // path to existing Paper JAR, relative to project root
  path?: string    // override server directory path
}
```

Update `PackageManifest`:

```ts
export interface PackageManifest {
  // ...existing fields...
  server?: ServerConfig
}
```

### `src/util/toml.ts`

`TomlParser.read()` must parse the `[server]` TOML section into `manifest.server`. Pattern follows the existing `grammar` and `runtime` section parsing.

## Server Directory

**Default:** `path.join(os.homedir(), '.quill', 'server')`

**Override:** `manifest.server?.path`, resolved using `path.isAbsolute()` — if true, use as-is; otherwise resolve relative to project root. On Windows, `path.isAbsolute()` returns true for drive-letter paths (`C:\...`) and for paths starting with `\`. On both platforms, relative paths are resolved against the project root.

Structure after first-run setup:

```
<server-dir>/
  paper-1.21.4-123.jar      ← downloaded or copied; filename includes build number
  eula.txt                  ← written on first setup (eula=true)
  server.properties         ← written on first setup
  plugins/
    Ink.jar                 ← downloaded from GitHub releases; placed here so Paper loads it
    Ink/
      plugins/              ← grammar package runtime JARs (one per installed package)
      scripts/              ← compiled .inkc files (cleared and rewritten on each deploy)
```

## First-Run Setup

Setup (Paper JAR download + `eula.txt` + `server.properties`) is triggered when no file matching `paper-*.jar` exists in the server directory. Each file is written independently and only if absent — user edits to `server.properties` are preserved on re-setup.

**Step 1: Resolve Paper JAR**

If `manifest.server?.jar` is set:
- Resolve path relative to project root
- Copy to `<server-dir>/` using the source filename

Otherwise, download from the Paper API (Minecraft version = `manifest.server?.paper ?? '1.21.4'`):

```
# 1. Get latest build number for the version
GET https://api.papermc.io/v2/projects/paper/versions/{version}/builds
→ parse JSON: builds[builds.length - 1].build  (latest build number)

# 2. Download the JAR
GET https://api.papermc.io/v2/projects/paper/versions/{version}/builds/{build}/downloads/paper-{version}-{build}.jar
→ write to <server-dir>/paper-{version}-{build}.jar
```

Downloads are written atomically: stream to `<server-dir>/paper-{version}-{build}.jar.tmp`, then rename to the final filename on success. If the process is interrupted mid-download, the `.tmp` file is left behind and the re-run will attempt the download again (the `paper-*.jar` glob will not match a `.tmp` file).

**Step 2: Download `Ink.jar`** (if `<server-dir>/plugins/Ink.jar` absent)

```
GET https://github.com/inklang/ink/releases/latest/download/Ink.jar
→ write atomically to <server-dir>/plugins/Ink.jar
```

`Ink.jar` is a Paper plugin binary distributed via GitHub releases, not a grammar package. It is placed in `<server-dir>/plugins/` so that Paper loads it as a plugin on startup. Re-downloaded only if absent.

**Step 3: Write `eula.txt`** (if absent)

```
eula=true
```

**Step 4: Write `server.properties`** (if absent)

```
online-mode=false
server-port=25565
```

## Dev Loop

Each time `quill run` is invoked (after setup):

1. **Build (startup):** spawn `quill build` as a child process via `spawnSync(process.execPath, [cliPath, 'build'], { cwd: projectDir, stdio: 'inherit' })`. If it exits non-zero, quill exits with the same code. Using a subprocess isolates `process.exit(1)` calls inside `InkBuildCommand` from the parent process — both startup and watch rebuilds use this pattern for consistency.
2. **Deploy scripts:** clear `<server-dir>/plugins/Ink/scripts/` entirely, then copy all `dist/scripts/*.inkc`.
3. **Deploy grammar JARs:** copy `packages/<pkg-name>/dist/*.jar` → `<server-dir>/plugins/Ink/plugins/` for each installed package. (Published packages include their built runtime JAR in `dist/` per `quill publish` behaviour.)
4. **Spawn server:**
   ```ts
   const server = spawn('java', ['-jar', paperJar, '--nogui'], {
     cwd: serverDir,
     stdio: ['pipe', 'inherit', 'inherit'],
     // index 0 = stdin  → 'pipe'    (reserved for future `ink reload\n` console command)
     // index 1 = stdout → 'inherit' (streams Paper output directly to terminal)
     // index 2 = stderr → 'inherit' (streams JVM errors directly to terminal)
   })
   ```
5. Unless `--no-watch`: start file watcher.

**SIGINT handling** (both modes): kill server child (`SIGTERM`, then `SIGKILL` after 5s if still alive), await `exit` event, close watcher, `process.exit(0)`.

## File Watching

Watch the same paths as `WatchCommand` (those that exist): `src/`, `scripts/`, `runtime/src/`.

On change:
1. **Debounce 300ms** — reset timer on each event.
2. **Kill server:** call `child.kill()` with no signal argument — Node.js translates this to `SIGTERM` on Unix and `TerminateProcess` on Windows (immediate, no signal-handling gap). Await the process `exit` event (max 5s). If still alive after 5s, call `child.kill('SIGKILL')` on Unix or `child.kill()` again on Windows, then await `exit` again. Do not proceed until the exit event fires. On Windows, Paper holds file locks on plugin JARs until the process fully exits — the copy step must not begin until exit is confirmed.
3. **Rebuild (watch mode):** same subprocess pattern as startup — `spawnSync(process.execPath, [cliPath, 'build'], { cwd: projectDir, stdio: ['inherit', 'inherit', 'inherit'] })`. If the subprocess exits non-zero, print a message, do not restart the server, and wait for the next change.
4. Re-deploy: clear `plugins/Ink/scripts/`, copy `.inkc`, copy grammar JARs.
5. Spawn new server process.

Only one server process runs at a time.

**Server exit handling in watch mode:** if the server exits for any reason (including `/stop` command), treat it as a crash — re-deploy and restart automatically. This means a user-initiated `/stop` will restart the server; that is acceptable for a dev tool.

**Server exit handling in `--no-watch` mode:** when the server exits, quill exits with the same exit code.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Paper API unreachable | `console.error` with URL + `process.exit(1)` |
| Paper download interrupted | `.tmp` file left behind; next run retries download |
| `Ink.jar` download fails | `console.error` + `process.exit(1)` |
| `java` not on PATH | `Error: Java not found. Install Java 17+ and ensure it is on your PATH.` + `process.exit(1)` |
| Build fails on startup | `InkBuildCommand` calls `process.exit(1)` internally — quill exits |
| Build fails during watch | Subprocess exits non-zero; print stderr, keep watcher alive, wait for next change |
| Server spawn fails | `console.error` + `process.exit(1)` |

## Implementation Notes

- New file: `src/commands/run.ts` — `RunCommand` class
- Register in `cli.ts` with `requireProject()` guard and `--no-watch` boolean option
- Server directory resolution: `manifest.server?.path` resolved against project root if relative → fallback to `path.join(os.homedir(), '.quill', 'server')`
- Paper JAR discovery: `readdirSync(serverDir).find(f => /^paper-.*\.jar$/.test(f))`
- `java` detection: `execSync('java -version', { stdio: 'pipe' })` in try/catch
- Atomic download: add `FileUtils.downloadFileAtomic(url, dest)` to `src/util/fs.ts` — uses `fetch()` (which auto-follows HTTP redirects, required for the GitHub releases URL), streams the response body to `dest + '.tmp'`, then `fs.renameSync(tmp, dest)` on success. Existing `downloadFile` callers are unchanged. All downloads in `RunCommand` use `downloadFileAtomic`.
- Watch rebuild: `spawnSync(process.execPath, [cliPath, 'build'], { cwd: projectDir, stdio: 'inherit' })` where `cliPath` is resolved as `fileURLToPath(new URL('../cli.js', import.meta.url))` (since `run.ts` compiles to `dist/commands/run.js` and the CLI entry is `dist/cli.js`)

## Out of Scope

- Remote server deployment
- Multiple concurrent server instances
- Paper version upgrades / server management commands
- `/ink reload` implementation (ink-bukkit concern)
- Ink.jar version pinning (always latest GitHub release)
- Checksum verification of downloaded Paper JAR
