# Quill CLI Visual Identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ASCII art mascot "Quill" and color output to key CLI commands (`new`, `build`, `publish`, `watch`). Colors always on, no flag support.

**Architecture:** Create a `src/ui/` module with two files — `colors.ts` (ANSI color helpers via colorette) and `ascii.ts` (ASCII art strings and splash output helpers). Commands import from `src/ui/` rather than using inline color codes.

**Tech Stack:** `colorette` (zero-dep ANSI color library), TypeScript, Node.js.

---

## File Map

| File | Change |
|------|--------|
| `package.json` | Add `colorette` dependency |
| `src/ui/colors.ts` | **New** — color constants and helpers |
| `src/ui/ascii.ts` | **New** — ASCII art strings and splash functions |
| `src/commands/new.ts` | Add welcome splash, replace console.log list with simple `console.log(package name)` |
| `src/commands/ink-build.ts` | Add success splash |
| `src/commands/publish.ts` | Add success splash |
| `src/commands/watch.ts` | Add watch start splash |

---

## Task 1: Add colorette dependency

**Files:**
- Modify: `package.json:34-38`

- [ ] **Step 1: Add colorette to dependencies**

Run: `npm install colorette --save`
Expected: `colorette` added to `dependencies` in package.json

- [ ] **Step 2: Commit**

```bash
npm install colorette --save
git add package.json package-lock.json
git commit -m "chore: add colorette for ANSI color output"
```

---

## Task 2: Create src/ui/colors.ts

**Files:**
- Create: `src/ui/colors.ts`

- [ ] **Step 1: Write src/ui/colors.ts**

```typescript
import * as colorette from 'colorette';

// Semantic color helpers — always on (no flag support)
export const cli = {
  /** Green — success, completion */
  success: (text: string) => colorette.green(text),

  /** Red — errors, failures */
  error: (text: string) => colorette.red(text),

  /** Cyan — info labels, section headers, metadata */
  info: (text: string) => colorette.cyan(text),

  /** Yellow — warnings */
  warn: (text: string) => colorette.yellow(text),

  /** Bold white — package names, versions */
  bold: (text: string) => colorette.white(colorette.bold(text)),

  /** Gray — muted / secondary text */
  muted: (text: string) => colorette.gray(text),
};

export const print = {
  success: (text: string) => console.log(cli.success(text)),
  error: (text: string) => console.error(cli.error(text)),
  info: (text: string) => console.log(cli.info(text)),
  warn: (text: string) => console.log(cli.warn(text)),
  bold: (text: string) => console.log(cli.bold(text)),
  muted: (text: string) => console.log(cli.muted(text)),
};
```

- [ ] **Step 2: Verify TypeScript accepts it**

Run: `npx tsc --noEmit src/ui/colors.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ui/colors.ts
git commit -m "feat(ui): add color helpers via colorette"
```

---

## Task 3: Create src/ui/ascii.ts

**Files:**
- Create: `src/ui/ascii.ts`

- [ ] **Step 1: Write src/ui/ascii.ts**

```typescript
import { cli, print } from './colors.js';

/** The Quill mascot */
const MASCOT = `   (o>
\\_//)
 \\_/_)
  _|_`;

/**
 * Print a key-moment splash with the mascot and a one-liner message.
 * @param message The contextual message to show below the mascot
 */
export function splash(message: string): void {
  console.log(MASCOT);
  console.log('');
  print.success(`  ${message}`);
  console.log('');
}

/** Shorthand for success-state splashes */
export const success = {
  new: () => splash('Welcome to Quill! Your new package is ready.'),
  build: () => splash('Build complete!'),
  publish: () => splash('Published successfully!'),
  watch: () => splash('Watching for changes...'),
};
```

- [ ] **Step 2: Verify TypeScript accepts it**

Run: `npx tsc --noEmit src/ui/ascii.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ui/ascii.ts
git commit -m "feat(ui): add ASCII mascot and splash helpers"
```

---

## Task 4: Add splash to quill new

**Files:**
- Modify: `src/commands/new.ts:112-118`

Current end of `run()`:
```typescript
    console.log(`Created package: ${name}/`);
    console.log('  ink-package.toml');
    console.log('  src/grammar.ts');
    console.log('  scripts/main.ink');
    console.log('  runtime/build.gradle.kts');
    console.log(`  runtime/src/main/kotlin/${className}Runtime.kt`);
```

- [ ] **Step 1: Replace console.log list with import and splash**

Add to imports in `new.ts`:
```typescript
import { success as splash } from '../ui/ascii.js';
```

Replace the 5-line console.log block with:
```typescript
    splash.new();
    print.muted(`  Package: ${name}/`);
```

- [ ] **Step 2: Verify TypeScript accepts it**

Run: `npx tsc --noEmit src/commands/new.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/commands/new.ts
git commit -m "feat(ui): add welcome splash to quill new"
```

---

## Task 5: Add success splash to quill build

**Files:**
- Modify: `src/commands/ink-build.ts`

- [ ] **Step 1: Add import at top of ink-build.ts**

```typescript
import { success as splash } from '../ui/ascii.js';
```

- [ ] **Step 2: Replace `console.log('Wrote dist/ink-manifest.json')` with splash**

In the `run()` method, after the final `console.log('Wrote dist/ink-manifest.json')`, replace that and replace it with:

```typescript
    console.log('Wrote dist/ink-manifest.json')
    splash.build()
```

- [ ] **Step 3: Verify TypeScript accepts it**

Run: `npx tsc --noEmit src/commands/ink-build.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/ink-build.ts
git commit -m "feat(ui): add build success splash"
```

---

## Task 6: Add success splash to quill publish

**Files:**
- Modify: `src/commands/publish.ts`

- [ ] **Step 1: Add import at top of publish.ts**

```typescript
import { success as splash } from '../ui/ascii.js';
```

- [ ] **Step 2: Replace final console.log with splash**

Current end of `run()`:
```typescript
    console.log(`Published ${manifest.name}@${manifest.version}`)
```

Replace with:
```typescript
    splash.publish()
```

- [ ] **Step 3: Verify TypeScript accepts it**

Run: `npx tsc --noEmit src/commands/publish.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/publish.ts
git commit -m "feat(ui): add publish success splash"
```

---

## Task 7: Add splash to quill watch

**Files:**
- Modify: `src/commands/watch.ts`

- [ ] **Step 1: Add import at top of watch.ts**

```typescript
import { success as splash } from '../ui/ascii.js';
```

- [ ] **Step 2: Replace `console.log('Build complete.')` with splash**

Current:
```typescript
        console.log('Build complete.')
```

Replace with:
```typescript
        splash.build()
```

Also add splash after `console.log('Watching for changes:')` (the startup message), replacing the existing startup output:

Current (after the watchPaths loop):
```typescript
    console.log('Watching for changes:')
    for (const p of watchPaths) {
      console.log(`  ${p}`)
    }
```

Replace with:
```typescript
    console.log('')
    splash.watch()
    console.log('Watching:')
    for (const p of watchPaths) {
      console.log(`  ${p}`)
    }
```

- [ ] **Step 3: Verify TypeScript accepts it**

Run: `npx tsc --noEmit src/commands/watch.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/watch.ts
git commit -m "feat(ui): add watch start splash"
```

---

## Spec Coverage Check

- [x] Mascot ASCII art in `src/ui/ascii.ts` — Task 3
- [x] Color helpers in `src/ui/colors.ts` — Task 2
- [x] `quill new` welcome splash — Task 4
- [x] `quill build` success splash — Task 5
- [x] `quill publish` success splash — Task 6
- [x] `quill watch` start splash — Task 7
- [x] `package.json` colorette dependency — Task 1
- [x] `src/ui/` module — Tasks 2 and 3
- [x] Commands remain quiet (ls, remove, add, install, clean, check unchanged)
- [x] No `--no-color` or `NO_COLOR` support

No placeholder gaps found.
