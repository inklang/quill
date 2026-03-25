# Quill CLI Visual Identity — Design Spec

## Overview

Add expressive ASCII art and color output to the Quill CLI to make key moments memorable and aid scannability of output. Quill should feel alive and distinctive, not a generic package manager.

## Mascot: Quill

The mascot is the little bird character affectionately named "Quill":

```
   (o>
\_//)
 \_/_)
  _|_
```

He appears at key moments to add personality and brand identity.

## When to Show Art

ASCII art and mascot appear at **key moments only**:

| Command | Art Moment |
|---------|------------|
| `quill new` | Welcome splash after scaffolding completes |
| `quill build` | Shown on successful build |
| `quill publish` | Shown on successful publish |
| `quill watch` | Shown when watcher starts |

Commands that remain **quiet** (structured output, no art): `ls`, `remove`, `add`, `install`, `clean`, `check`.

## Color Palette

Colors are **always on** — no flag support, no `NO_COLOR` handling. This keeps the implementation simple and ensures the visual identity is always visible.

| Purpose | Color |
|---------|-------|
| Success / completion | Green |
| Errors / failures | Red |
| Info / metadata / labels | Cyan |
| Warnings | Yellow |
| Package names / versions | Bold white |
| Section headers / titles | Cyan |
| Muted / secondary text | Gray |

## Output Style

- Consistent vertical spacing between sections
- Clear visual hierarchy: section labels are cyan, data is white/bold
- No emoji outside of ASCII art contexts (no emoji in structured output)
- ASCII art is paired with contextual one-liner text
- Errors include the error detail clearly and exit with non-zero code

## ASCII Art Content

### `quill new` welcome splash

```
   (o>
\_//)
 \_/_)
  _|_

  Welcome to Quill! ✨
  Your new package is ready.
```

### `quill build` success

```
   (o>
\_//)
 \_/_)
  _|_

  Build complete!
```

### `quill publish` success

```
   (o>
\_//)
 \_/_)
  _|_

  Published successfully!
```

### `quill watch` start

```
   (o>
\_//)
 \_/_)
  _|_

  Watching for changes...
```

## Structured Output Examples

### `quill ls` (no art)

```
Installed packages (2):
  inklang/logger  v1.2.0
  inklang/http    v0.9.1
```

### `quill install` (no art)

```
Resolving dependencies for my-package...
Installing inklang/logger v1.2.0...
Installed 1 package(s).
```

### Error output

```
[ERROR] Gradle build failed:
  > Build canceled

[ERROR] Run `quill build` to retry.
```

## Technical Approach

- Add `colorette` or similar zero-dependency color library to `dependencies`
- Create `src/ui/ascii.ts` — ASCII art strings and colored output helpers
- Create `src/ui/colors.ts` — color constants and utility functions
- Commands import from `src/ui/` — no inline color codes in command files
- Each command file is updated individually to use the new helpers
- No `--no-color` or `NO_COLOR` support (always on)

## Files to Change

- `src/ui/ascii.ts` — new file with ASCII art constants and helper functions
- `src/ui/colors.ts` — new file with color helpers
- `src/cli.ts` — no change (Commander handles --version, etc.)
- `src/commands/new.ts` — add welcome splash
- `src/commands/ink-build.ts` — add success splash
- `src/commands/publish.ts` — add success splash
- `src/commands/watch.ts` — add watch start splash
- `package.json` — add colorette dependency
