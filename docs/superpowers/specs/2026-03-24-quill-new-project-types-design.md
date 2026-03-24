# Design: quill new — Script Projects vs Grammar Packages

**Date:** 2026-03-24

## Problem

`quill new <name>` currently scaffolds a full grammar package (grammar TypeScript entry, Kotlin runtime directory, full manifest). Most users are script authors who just want to write `.ink` files and use installed packages — they should never need to think about grammars or Kotlin runtimes. The grammar/runtime scaffolding is noise for them and a barrier to getting started.

## Mental Model

Borrowed from Rust's bin/lib crate distinction:

- **Project** (default) — a runnable collection of `.ink` scripts. Consumes packages. No grammar authoring, no Kotlin.
- **Package** (`--package`) — a publishable grammar extension with a TypeScript grammar definition and a Kotlin runtime. Built by language/environment developers.

All things are projects. Packages are a special kind of project that extends the language.

## Command Interface

```
quill new <name>                        # interactive wizard, scaffolds script project
quill new <name> --template=<name>      # skip wizard, use named template directly
quill new <name> --package              # scaffold grammar+runtime package, no wizard
```

### Error handling

All three error cases call `process.exit(1)` (not `return`) so the CLI exits with a non-zero code. The existing `return` in the directory-exists check must be replaced.

**Mutual exclusion** — `--template` and `--package` are mutually exclusive. Check `--package` first in the action handler:

```
Error: --template and --package are mutually exclusive
```

**Directory exists:**

```
Error: Directory already exists: my-project/
```

**Unknown template name** (only reachable via `--template`):

```
Error: Unknown template "foo". Available templates: blank, hello-world, full
```

### Templates

Three built-in templates (hardcoded inline string constants in `NewCommand`; do not use or modify `defaultManifest()` for the script path — build the manifest object directly):

| Name | `scripts/main.ink` content |
|------|---------------------------|
| `blank` | `// <name>` |
| `hello-world` | `print("Hello, world!")` |
| `full` | multi-line example with a function definition and call |

### Wizard (script project, no `--template` or `--package` flag)

```
Creating project: my-scripts
Logged in (fingerprint: a1b2c3d4e5f67890)

? Select a template:
  [1] blank        — empty project
  [2] hello-world  — starter script
  [3] full         — example project

Enter number (default: 1):
```

- Non-TTY check: `!process.stdin.isTTY` → skip wizard, use `"blank"`.
- `--package` always skips the wizard entirely (no TTY check needed).
- "Logged in" line shown only if `readRc()` returns both `privateKey` and `publicKey` as truthy. If `readRc()` throws for any reason, silently skip the line.
- Fingerprint is the 16-character hex string returned by `fingerprint(publicKey)`.
- Input `1`/`2`/`3` selects the corresponding template. Empty input selects `blank`. Any other input re-prompts the same question.
- Uses Node's built-in `readline` in line-mode — no new dependencies, no raw TTY mode.

`promptTemplate()` returns the selected **template name** as a string (e.g. `"blank"`), not the file content. A switch in the scaffold logic maps name → content.

## Scaffolded Files

### Script project (all templates)

```
<name>/
  ink-package.toml
  scripts/main.ink
```

`ink-package.toml` fields, written in this order (do not include `description`):

| Field | Value |
|-------|-------|
| `name` | provided project name |
| `version` | `"0.1.0"` |
| `main` | `"main"` (stem of `scripts/main.ink`) |
| `dependencies` | empty object |
| `author` | fingerprint string — only when both keys present; field omitted entirely (undefined) otherwise |

No `grammar` or `runtime` sections.

### Package project (`--package`)

Unchanged from current behavior:

```
<name>/
  ink-package.toml            # main: "mod", includes grammar + runtime sections
  src/grammar.ts
  scripts/main.ink            # content: // <name> v0.1.0
  runtime/build.gradle.kts
  runtime/src/main/kotlin/<ClassName>Runtime.kt
```

`<ClassName>` is derived at runtime by splitting the package name on `.` and `-`, capitalizing each segment, and joining (e.g. `ink.mobs` → `InkMobs`).

## Success Messages

Script project:

```
Created project: my-scripts/
  ink-package.toml
  scripts/main.ink
```

Package project (resolved class name in the Kotlin file path):

```
Created package: my-package/
  ink-package.toml
  src/grammar.ts
  scripts/main.ink
  runtime/build.gradle.kts
  runtime/src/main/kotlin/MyPackageRuntime.kt
```

## Implementation Notes

- `NewCommand.run()` accepts `isPackage: boolean` and `template: string | undefined`.
- Wizard extracted into `promptTemplate(): Promise<string>` — returns template name string.
- **Do not use `defaultManifest()`** for the script project path — it hardcodes `main: "mod"`. Build the manifest object directly.
- Three string constants for template content; a switch selects based on name.
- Mutual exclusion and unknown template validation happen in the CLI action handler before constructing `NewCommand`.

## Out of Scope

- Remote or community templates via registry
- `quill init` changes (existing command, unchanged)
- Changes to `quill add` grammar wiring (separate concern)
