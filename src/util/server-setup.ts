import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, isAbsolute } from 'path'
import { homedir } from 'os'
import { FileUtils } from './fs.js'
import type { PackageManifest } from '../model/manifest.js'

type ManifestSubset = Pick<PackageManifest, 'server' | 'target' | 'build'>

export function ensureServerDir(serverDir: string): void {
  mkdirSync(join(serverDir, 'plugins', 'Ink', 'scripts'), { recursive: true })
  mkdirSync(join(serverDir, 'plugins', 'Ink', 'plugins'), { recursive: true })

  const eulaPath = join(serverDir, 'eula.txt')
  if (!existsSync(eulaPath)) {
    writeFileSync(eulaPath, 'eula=true\n')
  }
}

export async function downloadInkJar(serverDir: string): Promise<string> {
  const inkJarPath = join(serverDir, 'plugins', 'Ink.jar')
  const bukkitJarPath = join(serverDir, 'plugins', 'Ink-bukkit.jar')

  if (existsSync(inkJarPath)) {
    return inkJarPath
  }
  if (existsSync(bukkitJarPath)) {
    return bukkitJarPath
  }

  await FileUtils.downloadFileAtomic(
    'https://github.com/inklang/ink/releases/latest/download/Ink.jar',
    inkJarPath
  )

  return inkJarPath
}

export function resolveServerDir(
  projectDir: string,
  manifest: ManifestSubset
): string {
  const serverPath = manifest.server?.path
  if (serverPath) {
    return isAbsolute(serverPath)
      ? serverPath
      : join(projectDir, serverPath)
  }
  const targetName = manifest.target ?? manifest.build?.target ?? 'paper'
  return join(homedir(), '.quill', 'server', targetName)
}
