import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface CacheEntry {
  hash: string
  output: string
  compiledAt: string
}

export interface CacheManifest {
  version: 1
  lastFullBuild: string
  grammarIrHash: string | null
  runtimeJarHash: string | null
  entries: Record<string, CacheEntry>
}

const MANIFEST_NAME = 'manifest.json'

export class CacheManifestStore {
  constructor(private cacheDir: string) {}

  private manifestPath(): string {
    return join(this.cacheDir, MANIFEST_NAME)
  }

  read(): CacheManifest | null {
    const path = this.manifestPath()
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as CacheManifest
    } catch {
      return null
    }
  }

  write(manifest: CacheManifest): void {
    mkdirSync(this.cacheDir, { recursive: true })
    writeFileSync(this.manifestPath(), JSON.stringify(manifest, null, 2))
  }
}
