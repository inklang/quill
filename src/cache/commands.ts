import { CacheManifestStore } from './manifest.js'
import { readdirSync, statSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

export class CacheCommand {
  constructor(private projectDir: string) {}

  run(): void {
    const cacheDir = join(this.projectDir, '.quill', 'cache')
    const store = new CacheManifestStore(cacheDir)
    const manifest = store.read()

    console.log(`Cache: .quill/cache`)

    if (!manifest) {
      console.log('No cache manifest found.')
      return
    }

    // Compute size
    let totalSize = 0
    const entries: { path: string; size: number }[] = []
    if (existsSync(cacheDir)) {
      for (const f of readdirSync(cacheDir)) {
        const full = join(cacheDir, f)
        const stat = statSync(full)
        if (stat.isFile()) {
          totalSize += stat.size
          entries.push({ path: f, size: stat.size })
        }
      }
    }

    const sizeKB = Math.round(totalSize / 1024)
    console.log(`Size:  ${sizeKB} KB`)
    console.log(`Entries:${Object.keys(manifest.entries).length}`)
    console.log(`Last full build: ${manifest.lastFullBuild ? new Date(manifest.lastFullBuild).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '') : 'none'}`)
    console.log('')

    for (const [relPath, entry] of Object.entries(manifest.entries)) {
      console.log(`${relPath}  ${entry.hash.slice(0, 7)}  →  ${entry.output}`)
    }
  }
}

export class CacheCleanCommand {
  constructor(private projectDir: string) {}

  run(): void {
    const cacheDir = join(this.projectDir, '.quill', 'cache')
    if (!existsSync(cacheDir)) {
      console.log('Nothing to clean (.quill/cache/ does not exist).')
      return
    }
    rmSync(cacheDir, { recursive: true, force: true })
    console.log('Removed .quill/cache/')
  }
}
