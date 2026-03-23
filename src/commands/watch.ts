import { TomlParser } from '../util/toml.js'
import { InkBuildCommand } from './ink-build.js'
import { join } from 'path'
import { existsSync } from 'fs'
import chokidar from 'chokidar'

export class WatchCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'))

    const watchPaths: string[] = []

    const srcDir = join(this.projectDir, 'src')
    if (existsSync(srcDir)) watchPaths.push(srcDir)

    const scriptsDir = join(this.projectDir, 'scripts')
    if (existsSync(scriptsDir)) watchPaths.push(scriptsDir)

    const runtimeSrcDir = join(this.projectDir, 'runtime/src')
    if (existsSync(runtimeSrcDir)) watchPaths.push(runtimeSrcDir)

    if (watchPaths.length === 0) {
      console.log('Nothing to watch — no src/, scripts/, or runtime/src/ directories found')
      return
    }

    console.log('Watching for changes:')
    for (const p of watchPaths) {
      console.log(`  ${p}`)
    }

    let building = false
    let pendingBuild = false

    const doBuild = async () => {
      if (building) {
        pendingBuild = true
        return
      }
      building = true
      console.log('\nRebuilding...')
      try {
        const cmd = new InkBuildCommand(this.projectDir)
        await cmd.run()
        console.log('Build complete.')
      } catch (e: any) {
        console.error('Build failed:', e.message ?? e)
      }
      building = false
      if (pendingBuild) {
        pendingBuild = false
        doBuild()
      }
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      ignored: /(^|[\/\\])\../,
    })

    watcher.on('all', (event, path) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        console.log(`\nChange detected: ${path}`)
        doBuild()
      }, 300)
    })

    process.on('SIGINT', () => {
      console.log('\nStopping watcher...')
      watcher.close()
      process.exit(0)
    })
  }
}
