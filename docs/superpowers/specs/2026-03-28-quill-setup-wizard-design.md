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

Source: latest release asset from the ink repository's GitHub releases. The JAR filename includes version for future update detection.

### 3. Project Initialization

Prompt: "Initialize Ink scripts project? [Y/n]"

Runs equivalent of `quill init` in the server directory:
- Creates `ink-package.toml` with basic metadata
- Creates `scripts/` directory
- Sets `[deploy] server = "."` in ink-package.toml so `quill build` knows to copy output to `./plugins/Ink/plugins/`

The `[deploy]` section in ink-package.toml:

```toml
[deploy]
server = "."
```

This tells `quill build` to copy compiled output into `./plugins/Ink/plugins/<package-name>/` after building.

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

When `[deploy] server` is set in ink-package.toml:

1. Build proceeds as normal (compile grammar, compile scripts)
2. After build, copy output to `<server-path>/plugins/Ink/plugins/<package-name>/`
3. Copy includes: `ink-manifest.json`, `grammar.ir.json`, `scripts/*.inkc`

When `[deploy] server` is NOT set, `quill build` works as it does today (outputs to `dist/`).

This means existing Ink developers are unaffected — the deploy behavior only activates when setup has configured a server path.

## Ink JAR Download

- Fetch from GitHub releases API: `https://api.github.com/repos/<owner>/<repo>/releases/latest`
- Find the asset matching `Ink-*.jar` or `ink-bukkit-*.jar`
- Download to `<server>/plugins/Ink.jar`
- Future: support `quill setup --ink-version <version>` for pinning

## Idempotency

`quill setup` is safe to re-run:
- If server dir exists and is valid, skip creation
- If Ink JAR exists, skip download
- If ink-package.toml exists, skip init (but offer to update deploy path)
- If `[deploy] server` already set, confirm it's still valid

## Out of Scope

- Downloading Paper itself (admin brings their own JAR)
- Server configuration (server.properties, etc.)
- Auto-compilation of .ink files by the Ink plugin at runtime
- Server kit presets or curated package bundles
- Live reload or hot-deploy (admin uses `/ink reload` in-game)
- Remote server deployment (SSH, FTP, etc.) — local filesystem only

## Commands Affected

| Command | Change |
|---------|--------|
| `quill setup` (new) | Interactive wizard for server setup |
| `quill build` | Add deploy step when `[deploy] server` is configured |
| `quill init` | No changes (setup wraps it) |

## Dependencies

- GitHub releases API for Ink JAR download
- Existing `quill init`, `quill add`, `quill build` commands (wrapped, not duplicated)
- Inquirer.js or similar for interactive prompts (check if already a dependency)
