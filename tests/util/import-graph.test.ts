import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { discoverImportGraph } from '../../src/util/import-graph.js'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

const FIXTURE_DIR = join(tmpdir(), 'ink-import-graph-test')

beforeEach(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
})

describe('discoverImportGraph', () => {
  it('returns just the entry point when no imports', () => {
    const main = join(FIXTURE_DIR, 'main.ink')
    writeFileSync(main, 'print("hello")')
    const result = discoverImportGraph(main)
    expect(result).toEqual([resolve(main)])
  })

  it('follows a single import', () => {
    const main = join(FIXTURE_DIR, 'main.ink')
    const utils = join(FIXTURE_DIR, 'utils.ink')
    writeFileSync(main, 'import "./utils"\nprint("hello")')
    writeFileSync(utils, 'fn greet() { print("hi") }')
    const result = discoverImportGraph(main)
    expect(result).toHaveLength(2)
    expect(result).toContain(resolve(main))
    expect(result).toContain(resolve(utils))
  })

  it('follows selective imports', () => {
    const main = join(FIXTURE_DIR, 'main.ink')
    const utils = join(FIXTURE_DIR, 'utils.ink')
    writeFileSync(main, 'import greet, Config from "./utils"')
    writeFileSync(utils, 'fn greet() {}')
    const result = discoverImportGraph(main)
    expect(result).toHaveLength(2)
    expect(result).toContain(resolve(utils))
  })

  it('deduplicates diamond imports', () => {
    const main = join(FIXTURE_DIR, 'main.ink')
    const a = join(FIXTURE_DIR, 'a.ink')
    const b = join(FIXTURE_DIR, 'b.ink')
    const shared = join(FIXTURE_DIR, 'shared.ink')
    writeFileSync(main, 'import "./a"\nimport "./b"')
    writeFileSync(a, 'import "./shared"')
    writeFileSync(b, 'import "./shared"')
    writeFileSync(shared, 'fn helper() {}')
    const result = discoverImportGraph(main)
    expect(result).toHaveLength(4)
    expect(result).toContain(resolve(shared))
  })

  it('follows subdirectory imports', () => {
    const subDir = join(FIXTURE_DIR, 'mobs')
    mkdirSync(subDir, { recursive: true })
    const main = join(FIXTURE_DIR, 'main.ink')
    const zombie = join(subDir, 'zombie.ink')
    writeFileSync(main, 'import "./mobs/zombie"')
    writeFileSync(zombie, 'fn brains() {}')
    const result = discoverImportGraph(main)
    expect(result).toHaveLength(2)
    expect(result).toContain(resolve(zombie))
  })

  it('skips missing files gracefully', () => {
    const main = join(FIXTURE_DIR, 'main.ink')
    writeFileSync(main, 'import "./nonexistent"')
    const result = discoverImportGraph(main)
    expect(result).toEqual([resolve(main)])
  })

  it('follows parent directory imports', () => {
    const subDir = join(FIXTURE_DIR, 'sub')
    mkdirSync(subDir, { recursive: true })
    const main = join(subDir, 'main.ink')
    const shared = join(FIXTURE_DIR, 'shared.ink')
    writeFileSync(main, 'import "../shared"')
    writeFileSync(shared, 'fn helper() {}')
    const result = discoverImportGraph(main)
    expect(result).toHaveLength(2)
    expect(result).toContain(resolve(shared))
  })
})
