import * as clack from '@clack/prompts'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import { TomlParser } from '../util/toml.js'
import type { PackageManifest } from '../model/manifest.js'
import { ensureServerDir, downloadInkJar } from '../util/server-setup.js'

export interface SetupOptions {
  skipPrompts?: boolean
}

export class SetupCommand {
  constructor(private serverPath: string, private options: SetupOptions = {}) {}

  async run(): Promise<void> {
    clack.intro('Ink Server Setup')

    // Step 1: Server directory
    let serverDir = this.serverPath
    if (!this.options.skipPrompts) {
      const input = await clack.text({
        message: 'Path to your Paper server',
        initialValue: this.serverPath,
      })
      if (clack.isCancel(input)) { clack.cancel('Setup cancelled.'); process.exit(0) }
      serverDir = input as string
    }

    const serverExists = existsSync(serverDir)
    const hasServerProps = serverExists && existsSync(join(serverDir, 'server.properties'))

    if (!serverExists) {
      const shouldCreate = this.options.skipPrompts
        ? true
        : await clack.confirm({ message: `Directory "${serverDir}" not found. Create it?`, initialValue: true })
      if (clack.isCancel(shouldCreate) || !shouldCreate) {
        clack.cancel('Setup cancelled.')
        process.exit(0)
      }
    } else if (!hasServerProps) {
      const proceed = this.options.skipPrompts
        ? true
        : await clack.confirm({ message: 'This doesn\'t look like a Paper server (no server.properties). Continue anyway?', initialValue: false })
      if (clack.isCancel(proceed) || !proceed) {
        clack.cancel('Setup cancelled.')
        process.exit(0)
      }
    }

    const spin1 = clack.spinner()
    spin1.start('Creating server directory...')
    ensureServerDir(serverDir)
    spin1.stop('Server directory ready')

    // Step 2: Ink JAR
    const inkJarExists = existsSync(join(serverDir, 'plugins', 'Ink.jar')) ||
                         existsSync(join(serverDir, 'plugins', 'Ink-bukkit.jar'))

    if (!inkJarExists) {
      const shouldDownload = this.options.skipPrompts
        ? true
        : await clack.confirm({ message: 'Download Ink plugin?', initialValue: true })
      if (clack.isCancel(shouldDownload)) { clack.cancel('Setup cancelled.'); process.exit(0) }

      if (shouldDownload) {
        const spin2 = clack.spinner()
        spin2.start('Downloading Ink plugin...')
        try {
          await downloadInkJar(serverDir)
          spin2.stop('Ink plugin downloaded')
        } catch (e: any) {
          spin2.stop('Ink plugin download failed')
          clack.log.warn(`Could not download Ink JAR: ${e.message}`)
          clack.log.info('You can download it manually from https://github.com/inklang/ink/releases')
        }
      }
    } else {
      clack.log.success('Ink plugin already installed')
    }

    // Step 3: Initialize project
    const tomlPath = join(serverDir, 'ink-package.toml')
    if (!existsSync(tomlPath)) {
      const shouldInit = this.options.skipPrompts
        ? true
        : await clack.confirm({ message: 'Initialize Ink scripts project?', initialValue: true })
      if (clack.isCancel(shouldInit)) { clack.cancel('Setup cancelled.'); process.exit(0) }

      if (shouldInit) {
        const rawName = basename(serverDir).toLowerCase()
        const name = rawName.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'server'
        const manifest: PackageManifest = {
          name,
          version: '0.1.0',
          main: 'main',
          dependencies: {},
          server: { path: '.' },
        }
        writeFileSync(tomlPath, TomlParser.write(manifest))
        mkdirSync(join(serverDir, 'scripts'), { recursive: true })
        clack.log.success(`Created ink-package.toml: ${name} v0.1.0`)
      }
    } else {
      clack.log.success('ink-package.toml already exists')
    }

    // Summary
    clack.note(
      `1. Browse packages:  quill search <keyword>\n` +
      `   or visit: https://lectern.ink/packages\n\n` +
      `2. Add packages:     quill add <package-name>\n\n` +
      `3. Write scripts:    edit files in ${serverDir}/scripts/\n\n` +
      `4. Build & deploy:   quill build\n\n` +
      `5. Start server:     cd ${serverDir} && java -jar paper.jar`,
      'Next steps'
    )

    clack.outro('Setup complete!')
  }
}
