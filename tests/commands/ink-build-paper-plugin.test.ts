// tests/commands/ink-build-paper-plugin.test.ts
import { execSync } from 'child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const COMPILER = join(__dirname, '../../compiler/printing_press.exe')
const PAPER_PLUGIN_FIXTURE = join(__dirname, '../fixtures/paper-plugin')
const INK_PAPER_GRAMMAR = join(__dirname, '../fixtures/ink.paper/dist/paper/grammar.ir.json')

describe('ink build paper-plugin with ink.paper package', () => {
  let tmpPackagesDir: string

  beforeEach(() => {
    // Clean fixture dist
    try { rmSync(join(PAPER_PLUGIN_FIXTURE, 'dist'), { recursive: true }) } catch {}
    try { rmSync(join(PAPER_PLUGIN_FIXTURE, '.quill'), { recursive: true }) } catch {}

    // Set up a controlled packages dir with just the ink.paper grammar
    tmpPackagesDir = mkdtempSync(join(tmpdir(), 'quill-packages-'))
    const inkPaperDir = join(tmpPackagesDir, 'ink.paper')
    mkdirSync(inkPaperDir)

    copyFileSync(INK_PAPER_GRAMMAR, join(inkPaperDir, 'grammar.ir.json'))

    writeFileSync(join(inkPaperDir, 'ink.pkg'), JSON.stringify({
      name: 'ink.paper',
      version: '0.1.0',
      grammar: 'grammar.ir.json',
      runtime: { jar: 'ink-paper-0.1.0.jar', entry: 'org.inklang.paper.PaperBridge' },
      provides: ['mob', 'player', 'command', 'on_spawn', 'on_death', 'on_damage', 'on_tick', 'on_target', 'on_interact', 'on_join', 'on_leave', 'on_chat'],
      depends: [],
    }))
  })

  afterEach(() => {
    try { rmSync(tmpPackagesDir, { recursive: true, force: true }) } catch {}
  })

  it('compiles main.ink with player grammar declaration to CALL_HANDLER opcode', () => {
    execSync(`npx tsx ${CLI} build --full`, {
      cwd: PAPER_PLUGIN_FIXTURE,
      encoding: 'utf8',
      env: { ...process.env, INK_COMPILER: COMPILER, QUILL_PACKAGES_DIR: tmpPackagesDir },
    })

    const inkcPath = join(PAPER_PLUGIN_FIXTURE, 'dist/scripts/main.inkc')
    expect(existsSync(inkcPath)).toBe(true)

    const inkc = JSON.parse(readFileSync(inkcPath, 'utf8'))
    const chunk = inkc.chunk ?? inkc

    // CALL_HANDLER opcode is 0x31 = 49; stored in lower byte of each code word
    const hasCallHandler = chunk.code.some((word: number) => (word & 0xFF) === 0x31)
    expect(hasCallHandler, 'Expected CALL_HANDLER opcode (0x31) in compiled output').toBe(true)
  })

  it('compiled output has cstTable with player Greeter declaration', () => {
    execSync(`npx tsx ${CLI} build --full`, {
      cwd: PAPER_PLUGIN_FIXTURE,
      encoding: 'utf8',
      env: { ...process.env, INK_COMPILER: COMPILER, QUILL_PACKAGES_DIR: tmpPackagesDir },
    })

    const inkc = JSON.parse(readFileSync(join(PAPER_PLUGIN_FIXTURE, 'dist/scripts/main.inkc'), 'utf8'))
    const chunk = inkc.chunk ?? inkc

    expect(chunk.cstTable).toHaveLength(1)

    const decl = chunk.cstTable[0]
    expect(decl.t).toBe('decl')
    expect(decl.keyword).toBe('player')
    expect(decl.name).toBe('Greeter')

    const rule = decl.body[0]
    expect(rule.t).toBe('rule')
    expect(rule.ruleName).toBe('ink.paper/on_join_clause')

    const fnblk = rule.children.find((c: any) => c.t === 'fnblk')
    expect(fnblk).toBeDefined()
    expect(typeof fnblk.funcIdx).toBe('number')
  })

  it('on_join handler function body calls java.call with sendMessage', () => {
    execSync(`npx tsx ${CLI} build --full`, {
      cwd: PAPER_PLUGIN_FIXTURE,
      encoding: 'utf8',
      env: { ...process.env, INK_COMPILER: COMPILER, QUILL_PACKAGES_DIR: tmpPackagesDir },
    })

    const inkc = JSON.parse(readFileSync(join(PAPER_PLUGIN_FIXTURE, 'dist/scripts/main.inkc'), 'utf8'))
    const chunk = inkc.chunk ?? inkc

    const decl = chunk.cstTable[0]
    const fnblk = decl.body[0].children.find((c: any) => c.t === 'fnblk')
    const handlerFn = chunk.functions[fnblk.funcIdx]

    // string literals live in constants; identifier names (java, call, player) live in strings
    const constStrings = handlerFn.constants.filter((c: any) => c.t === 'string').map((c: any) => c.v)
    expect(constStrings).toContain('sendMessage')
    expect(constStrings).toContain('getName')
    expect(handlerFn.strings).toContain('player')
  })
})
