import { createHash } from 'crypto'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import { CacheManifest, CacheEntry } from './manifest.js'

export function hashFile(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}

export function hashGrammarIr(distDir: string): string | null {
  const grammarPath = join(distDir, 'grammar.ir.json')
  if (!existsSync(grammarPath)) return null
  return hashFile(grammarPath)
}

export interface DirtyFile {
  relativePath: string
  hash: string
}

export function findDirtyFiles(
  projectDir: string,
  scriptsDir: string,
  manifest: CacheManifest | null
): DirtyFile[] {
  const dirty: DirtyFile[] = []
  if (!existsSync(scriptsDir)) return dirty

  const files = readdirSync(scriptsDir).filter(f => f.endsWith('.ink'))
  for (const file of files) {
    const fullPath = join(scriptsDir, file)
    const relPath = relative(projectDir, fullPath).replace(/\\/g, '/')
    const hash = hashFile(fullPath)
    const existing = manifest?.entries[relPath]

    if (!existing || existing.hash !== hash) {
      dirty.push({ relativePath: relPath, hash })
    }
  }

  return dirty
}

export function buildManifest(
  lastFullBuild: string,
  grammarIrHash: string | null,
  runtimeJarHash: string | null,
  dirtyFiles: DirtyFile[]
): CacheManifest {
  const entries: Record<string, CacheEntry> = {}
  for (const f of dirtyFiles) {
    const output = f.relativePath.replace(/\.ink$/, '.inkc')
    entries[f.relativePath] = {
      hash: f.hash,
      output,
      compiledAt: new Date().toISOString(),
    }
  }
  return { version: 1, lastFullBuild, grammarIrHash, runtimeJarHash, entries }
}
