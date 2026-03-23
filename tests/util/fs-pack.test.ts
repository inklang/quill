import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { it, expect, afterEach } from 'vitest'
import { FileUtils } from '../../src/util/fs.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TMP = join(__dirname, '../fixtures/.tmp-pack-test')

afterEach(() => {
  try { rmSync(TMP, { recursive: true }) } catch {}
})

it('packTarGz creates a tarball and extractTarGz round-trips it', async () => {
  const srcDir = join(TMP, 'src')
  mkdirSync(join(srcDir, 'dist'), { recursive: true })
  writeFileSync(join(srcDir, 'ink-package.toml'), 'name = "test"')
  writeFileSync(join(srcDir, 'dist/grammar.ir.json'), '{}')

  const tarball = join(TMP, 'output.tar.gz')
  await FileUtils.packTarGz(srcDir, tarball, ['ink-package.toml', 'dist'])

  expect(existsSync(tarball)).toBe(true)

  const extractDir = join(TMP, 'extracted')
  await FileUtils.extractTarGz(tarball, extractDir)

  expect(existsSync(join(extractDir, 'ink-package.toml'))).toBe(true)
  expect(existsSync(join(extractDir, 'dist/grammar.ir.json'))).toBe(true)
})
