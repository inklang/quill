# `quill setup` — Server Admin Onboarding Wizard

## Problem

Paper server admins who want to use Ink must currently:
1. Know about the Ink project and find the JAR
2. Understand quill CLI commands (`init`, `add`, `build`)
3. Manually wire up the project structure and deployment

This is too much friction for admins who just want to "add scripts to my server."

## Solution

A `quill setup` command that handles the entire one-time server preparation in ~3 interactive prompts. After setup, the admin's workflow reduces to `quill add` and `quill build`.

## Target Audience

Paper server admins comfortable with terminals but unfamiliar with Ink/Quill. Secondary: existing Ink developers who want a quick way to scaffold a server.

## Command

```
quill setup [path]
```

- `path` defaults to `./server` (configurable via prompt)
- Alias: none needed (the command is self-explanatory)
- Registered in the **Project** command group in `COMMAND_GROUPS`, before `init` (since it's the recommended entry point for new users)
- Non-interactive mode (`--yes` flag) is deferred to a future iteration
- Does NOT call `requireProject()` — it creates the project, so it's exempt from the guard (like `quill new`, `quill init`, `quill login`, `quill search`)

## Shared Server Setup Module

`quill run` already performs server directory creation, Ink JAR download, and eula.txt setup (see `RunCommand` in `src/commands/run.ts`, lines 219-263). Rather than duplicating this logic, `quill setup` reuses it by extracting the shared pieces into `src/util/server-setup.ts`:

| Function | Responsibilities | Used by |
|----------|------------------|---------|
| `ensureServerDir(serverDir)` | Creates dir, writes `eula.txt`, creates `plugins/`, `plugins/Ink/scripts/`, `plugins/Ink/plugins/` | setup, run |
| `downloadInkJar(serverDir)` | Downloads latest Ink JAR to `<serverDir>/plugins/Ink.jar` | setup, run |
| `resolveServerDir(projectDir, manifest)` | Resolves `manifest.server?.path` (absolute → as-is, relative → join with projectDir, absent → `~/.quill/server/<target>`) | setup, run, build |

Note: `RunCommand` also creates `server.properties` and copies/links the Paper JAR — these are `quill run`-specific and stay in `RunCommand`, not the shared module.

Both `quill setup` and `quill run` import from this shared module. Bug fixes and changes to the setup flow only need to happen in one place.

## Flow

### 1. Server Directory

Prompt: "Path to your Paper server [./server]"

| Condition | Behavior |
|-----------|----------|
| Dir exists, has `server.properties` | Valid server. Use it. |
| Dir exists, no `server.properties` | Warn: "This doesn't look like a Paper server. Continue anyway? [y/N]" |
| Dir does not exist | Offer to create it with `eula.txt` and empty `plugins/` |

Server provisioning is minimal — create directory structure only. Does NOT download Paper itself. The admin brings their own `paper.jar`.

### 2. Ink Plugin JAR

Prompt: "Download Ink plugin? [Y/n]"

| Condition | Behavior |
|-----------|----------|
| `plugins/Ink*.jar` exists | Skip. "Ink plugin already installed." |
| Not found | Download latest from GitHub releases → `plugins/Ink.jar` |

Source: `https://github.com/inklang/ink/releases/latest/download/Ink.jar` — same direct download URL that `RunCommand` already uses. No API call needed.

### 3. Project Initialization

Prompt: "Initialize Ink scripts project? [Y/n]"

Does NOT shell out to `quill init`. Creates the ink-package.toml inline with the server path configured:

```toml
[package]
name = "server"
version = "0.1.0"
main = "main"

[server]
path = "."
```

This reuses the existing `[server]` section in `PackageManifest` (`manifest.server.path`) — the same field that `RunCommand.resolveServerDir()` reads. No new TOML sections needed.

**Path semantics:** When `path = "."`, the server directory equals the project directory (they're the same folder). The `[path]` argument determines where this combined project+server directory is created. If the admin points at an existing server (e.g. `/opt/minecraft/myserver`), the TOML gets `path = "/opt/minecraft/myserver"` and the project files are created there. If they accept the default `./server`, a new directory is created and `path = "."`.

Also creates an empty `scripts/` directory. The existing `InitCommand` does not create `scripts/` or set `[server]`, so setup handles this inline.

### 4. Summary

Prints next-steps guidance:

```
Setup complete!

  1. Browse packages:  quill search <keyword>
     or visit: https://lectern.ink/packages

  2. Add packages:     quill add <package-name>

  3. Write scripts:    edit files in ./server/scripts/

  4. Build & deploy:   quill build

  5. Start server:     cd server && java -jar paper.jar
```

## Project Structure After Setup

```
server/
  eula.txt
  plugins/
    Ink.jar
  ink-package.toml
  scripts/
```

The quill project lives inside the server directory. Admins `cd` into their server and everything is there.

## Modified `quill build` Behavior

When `manifest.server?.path` is set (which `quill setup` configures):

1. Build proceeds as normal (compile grammar, compile scripts)
2. After build, call `deployScripts(serverDir, projectDir)` — the same function `quill run` already uses (exported from `src/commands/run.ts`, line 41)
3. Also call `deployGrammarJars(serverDir, projectDir)` — deploys grammar runtime JARs to the server (same as `quill run` does at line 104)
4. This clears `plugins/Ink/scripts/` and copies `dist/scripts/*.inkc` into it, plus grammar JARs

When `manifest.server?.path` is NOT set, `quill build` works as it does today (outputs to `dist/` only).

**Error cases:**
- Server dir does not exist → fail with "Server directory not found. Run `quill setup` first."
- `plugins/Ink/` does not exist (Ink plugin absent) → create the directory tree and continue with a warning
- Stale files → `deployScripts` already clears the entire scripts directory before copying, so stale files are handled

This means existing Ink developers are unaffected — the deploy behavior only activates when setup has configured a server path.

## Idempotency

`quill setup` is safe to re-run:
- If server dir exists and is valid, skip creation
- If Ink JAR exists, skip download
- If ink-package.toml exists, skip init (but offer to update server path if missing)
- If `[server] path` already set, confirm it's still valid

## Out of Scope

- Downloading Paper itself (admin brings their own JAR)
- Server configuration (server.properties, etc.)
- Auto-compilation of .ink files by the Ink plugin at runtime
- Server kit presets or curated package bundles
- Live reload or hot-deploy (admin uses `/ink reload` in-game)
- Remote server deployment (SSH, FTP, etc.) — local filesystem only
- Non-interactive / `--yes` mode (deferred to future iteration)

## Commands Affected

| Command | Change |
|---------|--------|
| `quill setup` (new) | Interactive wizard for server setup |
| `quill build` | Add deploy step when `manifest.server.path` is configured |
| `quill init` | No changes (setup creates TOML inline, doesn't call init) |
| `quill run` | Refactor: extract setup helpers into shared `src/util/server-setup.ts` |

## Dependencies

- **`@clack/prompts`** for the setup wizard UI — lightweight, beautiful terminal UI designed specifically for wizards. Gives a polished, boxed, ratatui-style look with spinners, progress bars, and styled prompts. Small dependency footprint, good Windows terminal support. Note: the existing CLI uses raw `readline` for prompts (`quill new`, `quill add`). Adopting `@clack/prompts` for `quill setup` is the first step; migrating existing commands to it is a separate follow-up task to keep scope focused.
- `inklang/ink` GitHub releases for Ink JAR download (same source as `quill run`)
- Shared `src/util/server-setup.ts` module (extracted from `RunCommand`)
- Existing `deployScripts()` and `deployGrammarJars()` functions from `src/commands/run.ts`
