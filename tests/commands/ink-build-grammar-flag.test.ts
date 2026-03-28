// tests/commands/ink-build-grammar-flag.test.ts
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')

describe('ink build grammar flag', () => {
  it('passes --grammar to native compiler in batch mode when grammar IR exists', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'quill-grammar-flag-'))
    const argsFile = join(tmpDir, 'compiler_args.txt').replace(/\\/g, '/')

    try {
      mkdirSync(join(tmpDir, 'scripts'))
      mkdirSync(join(tmpDir, 'dist'))

      writeFileSync(join(tmpDir, 'dist', 'grammar.ir.json'), JSON.stringify({
        version: 1,
        package: 'test.pkg',
        keywords: ['widget'],
        rules: {},
        declarations: [{ keyword: 'widget', nameRule: { type: 'identifier' }, scopeRules: [], inheritsBase: true }],
      }))

      writeFileSync(join(tmpDir, 'scripts', 'main.ink'), 'print("hello")\n')

      writeFileSync(join(tmpDir, 'ink-package.toml'), `[package]
name = "test.pkg"
version = "0.1.0"
main = "mod"
`)

      const mockCompiler = join(tmpDir, 'mock-compiler.sh')
      writeFileSync(mockCompiler, `#!/bin/bash
echo "$@" > "${argsFile}"
shift  # compile
SOURCES="" OUT=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --sources) SOURCES="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --grammar) shift 2;;
    *) shift;;
  esac
done
mkdir -p "$OUT"
for f in "$SOURCES"/*.ink; do
  [[ -f "$f" ]] || continue
  base=$(basename "$f" .ink)
  echo "compiled" > "$OUT/$base.inkc"
done
`)
      chmodSync(mockCompiler, 0o755)

      execSync(`npx tsx ${CLI} build --full`, {
        cwd: tmpDir,
        encoding: 'utf8',
        env: { ...process.env, INK_COMPILER: mockCompiler },
      })

      expect(existsSync(argsFile)).toBe(true)
      const args = readFileSync(argsFile, 'utf8').trim()
      expect(args).toContain('--grammar')
      expect(args).toContain('grammar.ir.json')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('passes --grammar to native compiler in incremental mode when grammar IR exists', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'quill-grammar-flag-incr-'))
    const argsFile = join(tmpDir, 'compiler_args.txt').replace(/\\/g, '/')

    try {
      mkdirSync(join(tmpDir, 'scripts'))
      mkdirSync(join(tmpDir, 'dist'))

      writeFileSync(join(tmpDir, 'dist', 'grammar.ir.json'), JSON.stringify({
        version: 1,
        package: 'test.pkg',
        keywords: ['widget'],
        rules: {},
        declarations: [{ keyword: 'widget', nameRule: { type: 'identifier' }, scopeRules: [], inheritsBase: true }],
      }))

      writeFileSync(join(tmpDir, 'scripts', 'main.ink'), 'print("hello")\n')

      writeFileSync(join(tmpDir, 'ink-package.toml'), `[package]
name = "test.pkg"
version = "0.1.0"
main = "mod"
`)

      const mockCompiler = join(tmpDir, 'mock-compiler.sh')
      writeFileSync(mockCompiler, `#!/bin/bash
echo "$@" >> "${argsFile}"
SINGLE_IN="" SINGLE_OUT=""
while [[ $# -gt 0 ]]; do
  case $1 in
    compile) shift;;
    --grammar) shift 2;;
    -o) SINGLE_OUT="$2"; shift 2;;
    *.ink) SINGLE_IN="$1"; shift;;
    *) shift;;
  esac
done
if [[ -n "$SINGLE_IN" && -n "$SINGLE_OUT" ]]; then
  mkdir -p "$(dirname "$SINGLE_OUT")"
  echo "compiled" > "$SINGLE_OUT"
fi
`)
      chmodSync(mockCompiler, 0o755)

      // Incremental build (no --full flag, no prior cache → compiles dirty files one by one)
      execSync(`npx tsx ${CLI} build`, {
        cwd: tmpDir,
        encoding: 'utf8',
        env: { ...process.env, INK_COMPILER: mockCompiler },
      })

      expect(existsSync(argsFile)).toBe(true)
      const args = readFileSync(argsFile, 'utf8').trim()
      expect(args).toContain('--grammar')
      expect(args).toContain('grammar.ir.json')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
