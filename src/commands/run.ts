import { TomlParser } from '../util/toml.js'
import { FileUtils } from '../util/fs.js'
import { PackageManifest } from '../model/manifest.js'
import { fileURLToPath } from 'url'
import {
  existsSync, mkdirSync, writeFileSync, readdirSync,
  copyFileSync, rmSync,
} from 'fs'
import { join, basename } from 'path'
import { execSync, spawnSync, spawn, ChildProcess } from 'child_process'
import chokidar from 'chokidar'
import { resolveServerDir, ensureServerDir, downloadInkJar } from '../util/server-setup.js'

export { resolveServerDir } from '../util/server-setup.js'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

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
export function deployGrammarJars(serverDir: string, projectDir: string, _target: string): void {
  const targetDir = join(serverDir, 'plugins', 'Ink', 'plugins')
  mkdirSync(targetDir, { recursive: true })

  const distDir = join(projectDir, 'dist')
  if (!existsSync(distDir)) return

  // Read JARs from dist/ (package artifacts were copied there by ink-build)
  for (const jar of readdirSync(distDir).filter(f => f.endsWith('.jar'))) {
    copyFileSync(join(distDir, jar), join(targetDir, jar))
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

    const target = this.manifest.target ?? this.manifest.build?.target ?? 'paper'
    const targetVersion = this.manifest.server?.paper ?? this.manifest.build?.targetVersion ?? '1.21.4'
    console.log(`Target: ${target.charAt(0).toUpperCase() + target.slice(1)}`)
    console.log(`Target-Version: ${targetVersion}`)
    console.log(`Server directory: ${this.serverDir}`)
    const paperJarPath = await this.setup()
    console.log(`Using JAR: ${paperJarPath} (${targetVersion})`)

    // Build
    const buildResult = spawnSync(process.execPath, [this.cliPath, 'build'], {
      cwd: this.projectDir,
      stdio: 'inherit',
    })
    if (buildResult.status !== 0) process.exit(buildResult.status ?? 1)

    // Deploy
    this.deployScripts()
    this.deployGrammarJars(this.manifest.target ?? 'paper')

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
    let restartBackoff = 2000
    let serverStartedAt = Date.now()

    const redeploy = async () => {
      if (redeployInProgress) return
      redeployInProgress = true
      try {
        await this.killServer(server)
        // Wait for OS to release the port — Windows holds sockets in TIME_WAIT
        // after TerminateProcess, causing "Address already in use" on fast restarts
        await sleep(2000)

        const buildResult = spawnSync(process.execPath, [this.cliPath, 'build'], {
          cwd: this.projectDir,
          stdio: 'inherit',
        })
        if (buildResult.status !== 0) {
          console.error('\nBuild failed — waiting for next change...')
          return
        }

        this.deployScripts()
        this.deployGrammarJars(this.manifest.target ?? 'paper')
        server = this.spawnServer(paperJarPath)
        serverStartedAt = Date.now()
        attachExitHandler()
      } finally {
        redeployInProgress = false
      }
    }

    // Server crash/stop handler: if server exits for any reason in watch mode,
    // treat it as a crash and restart automatically.  Back off if the server
    // dies quickly (e.g. port-binding failure) to avoid a rapid crash loop.
    const attachExitHandler = () => {
      server.once('exit', () => {
        if (!isShuttingDown) {
          const uptime = Date.now() - serverStartedAt
          if (uptime < 10_000) {
            restartBackoff = Math.min(restartBackoff * 2, 30_000)
          } else {
            restartBackoff = 2000
          }
          console.log(`\nServer exited — restarting in ${restartBackoff / 1000}s...`)
          setTimeout(() => redeploy(), restartBackoff)
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
    ensureServerDir(serverDir)

    // Step 1: Paper JAR — find one matching the target version, download if absent
    const targetVersion = this.manifest.server?.paper ?? this.manifest.build?.targetVersion ?? '1.21.4'
    const existingJar = readdirSync(serverDir).find(f => new RegExp(`^paper-${targetVersion}-\\d+\\.jar$`).test(f))
    let paperJarPath: string

    if (!existingJar) {
      paperJarPath = await this.downloadOrCopyPaperJar()
    } else {
      paperJarPath = join(serverDir, existingJar)
    }

    // Step 2: Ink.jar (only if absent)
    console.log('Downloading Ink.jar...')
    try {
      await downloadInkJar(serverDir)
      console.log('Downloaded Ink.jar')
    } catch (e: any) {
      console.error(`Failed to download Ink.jar: ${e.message}`)
      process.exit(1)
    }

    // Step 3: server.properties (only if absent)
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

    const version = this.manifest.server?.paper ?? this.manifest.build?.targetVersion ?? '1.21.4'
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

  private deployGrammarJars(target: string): void {
    deployGrammarJars(this.serverDir, this.projectDir, target)
  }

  private spawnServer(paperJarPath: string): ChildProcess {
    const target = this.manifest.target ?? this.manifest.build?.target ?? 'paper'
    const targetCfg = this.manifest.targets?.[target]
    const jvmArgs = targetCfg?.jvmArgs ?? []
    const env = targetCfg?.env
      ? { ...process.env, ...targetCfg.env }
      : process.env
    const server = spawn('java', [...jvmArgs, '-jar', paperJarPath, '--nogui'], {
      cwd: this.serverDir,
      stdio: 'inherit',
      env,
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
