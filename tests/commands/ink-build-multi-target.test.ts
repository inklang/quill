import { execSync } from 'child_process'
import { readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect, beforeEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const FIXTURE = join(__dirname, '../fixtures/multi-target-project')

const COMPILER = join(__dirname, '../../compiler/printing_press.exe')

describe('ink build with target-specific packages', () => {
  beforeEach(() => {
    try { rmSync(join(FIXTURE, 'dist'), { recursive: true }) } catch {}
    try { rmSync(join(FIXTURE, '.quill/cache'), { recursive: true }) } catch {}
    mkdirSync(join(FIXTURE, 'dist'), { recursive: true })
  })

  it('copies package runtime artifacts from matching target subfolder', () => {
    const result = execSync(`npx tsx ${CLI} build`, {
      cwd: FIXTURE,
      encoding: 'utf8',
      env: { ...process.env, INK_COMPILER: COMPILER },
    })

    // Project ink-manifest.json should have target = "paper"
    const manifest = JSON.parse(readFileSync(join(FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.target).toBe('paper')

    // Package runtime JAR should be copied to dist
    expect(existsSync(join(FIXTURE, 'dist/mobs-runtime.jar'))).toBe(true)
  })

  it('fails when installed package has no variant for project target', () => {
    // Setup: change the paper variant to wasm so no paper variant exists
    const paperDir = join(FIXTURE, 'packages/ink.mobs/paper')
    const wasmDir = join(FIXTURE, 'packages/ink.mobs/wasm')
    mkdirSync(wasmDir, { recursive: true })

    // Move paper's ink-manifest to wasm
    const oldManifest = JSON.parse(readFileSync(join(paperDir, 'ink-manifest.json'), 'utf8'))
    writeFileSync(join(wasmDir, 'ink-manifest.json'), JSON.stringify({
      ...oldManifest,
      target: 'wasm',
      runtime: { jar: 'mobs-runtime.wasm' }
    }))
    writeFileSync(join(wasmDir, 'mobs-runtime.wasm'), 'fake-wasm')

    // Update package's ink-manifest to wasm so old paper one is orphaned
    rmSync(paperDir, { recursive: true })

    try {
      execSync(`npx tsx ${CLI} build`, { cwd: FIXTURE, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, INK_COMPILER: COMPILER } })
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e.stderr.toString()).toContain('has no variant for target "paper"')
    } finally {
      // Restore paper variant
      mkdirSync(paperDir, { recursive: true })
      writeFileSync(join(paperDir, 'ink-manifest.json'), JSON.stringify(oldManifest))
      writeFileSync(join(paperDir, 'mobs-runtime.jar'), 'fake-jar')
      rmSync(wasmDir, { recursive: true })
    }
  })
})
