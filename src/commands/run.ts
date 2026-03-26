import { TomlParser } from '../util/toml.js'
import { FileUtils } from '../util/fs.js'
import { PackageManifest } from '../model/manifest.js'
import { fileURLToPath } from 'url'
import {
  existsSync, mkdirSync, writeFileSync, readdirSync,
  copyFileSync, rmSync,
} from 'fs'
import { join, isAbsolute, basename } from 'path'
import { homedir } from 'os'
import { execSync, spawnSync, spawn, ChildProcess } from 'child_process'
import chokidar from 'chokidar'

/**
 * Exported for testing. Resolves the server directory from manifest config.
 * manifest.server?.path is resolved with path.isAbsolute():
 *   - absolute → use as-is
 *   - relative → join with projectDir
 *   - absent → ~/.quill/server
 */
export function resolveServerDir(
  projectDir: string,
  manifest: Pick<PackageManifest, 'server'>
): string {
  const serverPath = manifest.server?.path
  if (serverPath) {
    return isAbsolute(serverPath)
      ? serverPath
      : join(projectDir, serverPath)
  }
  return join(homedir(), '.quill', 'server')
}

/**
 * Exported for testing. Clears and repopulates the server scripts directory
 * from dist/scripts/ in the project directory.
 */
export function deployScripts(serverDir: string, projectDir: string): void {
  const scriptsDir = join(serverDir, 'plugins', 'Ink', 'scripts')
  // Clear entirely before copying — removes stale scripts from previous deploys
  rmSync(scriptsDir, { recursive: true, force: true })
  mkdirSync(scriptsDir, { recursive: true })

  const distScripts = join(projectDir, 'dist', 'scripts')
  if (!existsSync(distScripts)) return

  for (const f of readdirSync(distScripts).filter(f => f.endsWith('.inkc'))) {
    copyFileSync(join(distScripts, f), join(scriptsDir, f))
  }
}

/**
 * Exported for testing. Copies grammar JARs from packages/*\/dist/*.jar into
 * the server's plugins/Ink/plugins/ directory.
 */
export function deployGrammarJars(serverDir: string, projectDir: string): void {
  const targetDir = join(serverDir, 'plugins', 'Ink', 'plugins')
  mkdirSync(targetDir, { recursive: true })

  const packagesDir = join(projectDir, 'packages')
  if (!existsSync(packagesDir)) return

  for (const pkgName of readdirSync(packagesDir)) {
    const pkgDist = join(packagesDir, pkgName, 'dist')
    if (!existsSync(pkgDist)) continue
    for (const jar of readdirSync(pkgDist).filter(f => f.endsWith('.jar'))) {
      copyFileSync(join(pkgDist, jar), join(targetDir, jar))
    }
  }
}

export class RunCommand {
  private manifest!: PackageManifest
  private serverDir!: string
  private cliPath: string

  constructor(private projectDir: string) {
    this.cliPath = fileURLToPath(new URL('../cli.js', import.meta.url))
  }

  async run(opts: { noWatch: boolean }): Promise<void> {
    this.manifest = TomlParser.read(join(this.projectDir, 'ink-package.toml'))
    this.serverDir = resolveServerDir(this.projectDir, this.manifest)

    this.checkJava()

    console.log(`Server directory: ${this.serverDir}`)
    const paperJarPath = await this.setup()

    // Build
    const buildResult = spawnSync(process.execPath, [this.cliPath, 'build'], {
      cwd: this.projectDir,
      stdio: 'inherit',
    })
    if (buildResult.status !== 0) process.exit(buildResult.status ?? 1)

    // Deploy
    this.deployScripts()
    this.deployGrammarJars()

    // Spawn server
    let server = this.spawnServer(paperJarPath)

    if (opts.noWatch) {
      server.on('exit', (code) => process.exit(code ?? 0))
      process.on('SIGINT', async () => {
        await this.killServer(server)
        process.exit(0)
      })
      return
    }

    // Watch mode
    let isShuttingDown = false
    let redeployInProgress = false

    const redeploy = async () => {
      if (redeployInProgress) return
      redeployInProgress = true
      try {
        await this.killServer(server)

        const buildResult = spawnSync(process.execPath, [this.cliPath, 'build'], {
          cwd: this.projectDir,
          stdio: 'inherit',
        })
        if (buildResult.status !== 0) {
          console.error('\nBuild failed — waiting for next change...')
          return
        }

        this.deployScripts()
        this.deployGrammarJars()
        server = this.spawnServer(paperJarPath)
        attachExitHandler()
      } finally {
        redeployInProgress = false
      }
    }

    // Server crash/stop handler: if server exits for any reason in watch mode,
    // treat it as a crash and restart automatically.
    const attachExitHandler = () => {
      server.once('exit', () => {
        if (!isShuttingDown) {
          console.log('\nServer exited — restarting...')
          redeploy()
        }
      })
    }
    attachExitHandler()

    // Watch src/, scripts/, runtime/src/ (only those that exist)
    const watchPaths: string[] = []
    for (const dir of ['src', 'scripts', 'runtime/src']) {
      const full = join(this.projectDir, dir)
      if (existsSync(full)) watchPaths.push(full)
    }

    if (watchPaths.length > 0) {
      const watcher = chokidar.watch(watchPaths, {
        ignoreInitial: true,
        ignored: /(^|[\/\\])\../,
      })

      let debounceTimer: ReturnType<typeof setTimeout> | null = null

      watcher.on('all', (_event, filePath) => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(async () => {
          console.log(`\nChange detected: ${filePath}`)
          await redeploy()
        }, 300)
      })

      process.on('SIGINT', async () => {
        isShuttingDown = true
        console.log('\nShutting down...')
        await this.killServer(server)
        watcher.close()
        process.exit(0)
      })
    } else {
      process.on('SIGINT', async () => {
        isShuttingDown = true
        await this.killServer(server)
        process.exit(0)
      })
    }
  }

  private checkJava(): void {
    try {
      execSync('java -version', { stdio: 'pipe' })
    } catch {
      console.error('Error: Java not found. Install Java 17+ and ensure it is on your PATH.')
      process.exit(1)
    }
  }

  private async setup(): Promise<string> {
    const serverDir = this.serverDir
    mkdirSync(join(serverDir, 'plugins', 'Ink', 'scripts'), { recursive: true })
    mkdirSync(join(serverDir, 'plugins', 'Ink', 'plugins'), { recursive: true })

    // Step 1: Paper JAR (only if none exists)
    const existingJar = readdirSync(serverDir).find(f => /^paper-.*\.jar$/.test(f))
    let paperJarPath: string

    if (!existingJar) {
      paperJarPath = await this.downloadOrCopyPaperJar()
    } else {
      paperJarPath = join(serverDir, existingJar)
    }

    // Step 2: Ink.jar (only if absent)
    const inkJarPath = join(serverDir, 'plugins', 'Ink.jar')
    if (!existsSync(inkJarPath)) {
      console.log('Downloading Ink.jar...')
      try {
        await FileUtils.downloadFileAtomic(
          'https://github.com/inklang/ink/releases/latest/download/Ink.jar',
          inkJarPath
        )
        console.log('Downloaded Ink.jar')
      } catch (e: any) {
        console.error(`Failed to download Ink.jar: ${e.message}`)
        process.exit(1)
      }
    }

    // Step 3: eula.txt (only if absent)
    const eulaPath = join(serverDir, 'eula.txt')
    if (!existsSync(eulaPath)) {
      writeFileSync(eulaPath, 'eula=true\n')
    }

    // Step 4: server.properties (only if absent)
    const propsPath = join(serverDir, 'server.properties')
    if (!existsSync(propsPath)) {
      writeFileSync(propsPath, 'online-mode=false\nserver-port=25565\n')
    }

    return paperJarPath
  }

  private async downloadOrCopyPaperJar(): Promise<string> {
    const serverDir = this.serverDir

    if (this.manifest.server?.jar) {
      // server.jar is always resolved relative to projectDir, regardless of server.path
      const src = join(this.projectDir, this.manifest.server.jar)
      const dest = join(serverDir, basename(src))
      copyFileSync(src, dest)
      console.log(`Copied Paper JAR: ${basename(src)}`)
      return dest
    }

    const version = this.manifest.server?.paper ?? '1.21.4'
    const buildsUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds`
    console.log(`Downloading Paper ${version}...`)

    let buildsData: { builds: { build: number }[] }
    try {
      const res = await fetch(buildsUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      buildsData = await res.json() as { builds: { build: number }[] }
    } catch (e: any) {
      console.error(`Failed to fetch Paper builds from ${buildsUrl}: ${e.message}`)
      process.exit(1)
    }

    if (!buildsData!.builds.length) {
      console.error(`No Paper builds found for version ${version}. Check that the version is valid.`)
      process.exit(1)
    }

    const build = buildsData!.builds[buildsData!.builds.length - 1].build
    const jarName = `paper-${version}-${build}.jar`
    const jarUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${build}/downloads/${jarName}`
    const dest = join(serverDir, jarName)

    try {
      await FileUtils.downloadFileAtomic(jarUrl, dest)
    } catch (e: any) {
      console.error(`Failed to download Paper JAR from ${jarUrl}: ${e.message}`)
      process.exit(1)
    }

    console.log(`Downloaded ${jarName}`)
    return dest
  }

  private deployScripts(): void {
    deployScripts(this.serverDir, this.projectDir)
  }

  private deployGrammarJars(): void {
    deployGrammarJars(this.serverDir, this.projectDir)
  }

  private spawnServer(paperJarPath: string): ChildProcess {
    const server = spawn('java', ['-jar', paperJarPath, '--nogui'], {
      cwd: this.serverDir,
      stdio: 'inherit',
    })
    server.on('error', (err: any) => {
      if (err.code === 'ENOENT') {
        console.error('Error: Java not found. Install Java 17+ and ensure it is on your PATH.')
      } else {
        console.error('Server spawn error:', err.message)
      }
      process.exit(1)
    })
    return server
  }

  private async killServer(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) return

    const exitPromise = new Promise<void>(resolve => child.once('exit', resolve))
    child.kill() // SIGTERM on Unix, TerminateProcess on Windows

    const timedOut = await Promise.race([
      exitPromise.then(() => false),
      new Promise<boolean>(resolve => setTimeout(() => resolve(true), 5000)),
    ])

    if (timedOut && child.exitCode === null) {
      if (process.platform === 'win32') {
        child.kill()
      } else {
        child.kill('SIGKILL')
      }
      await new Promise<void>(resolve => child.once('exit', resolve))
    }
  }
}
