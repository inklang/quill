import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const QUILL_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const COMPILER_DIR = join(QUILL_ROOT, 'compiler')
const COMPILER_NAME = process.platform === 'win32' ? 'printing_press.exe' : 'printing_press'
const REPO = 'inklang/printing_press'

interface GithubRelease {
  tag_name: string
  assets: { name: string; browser_download_url: string }[]
}

function tryPath(p: string): string | null {
  if (existsSync(p)) return p
  // Convert MSYS2/Git Bash paths (/c/foo) to Windows paths (C:/foo)
  const msys = p.match(/^\/([a-zA-Z])\/(.*)$/)
  if (msys) {
    const win = `${msys[1].toUpperCase()}:/${msys[2]}`
    if (existsSync(win)) return win
  }
  return null
}

function detectPlatform(): string {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'win32') return 'windows-latest'
  if (platform === 'darwin') return 'macos-latest'
  if (platform === 'linux') return 'ubuntu-latest'

  throw new Error(`Unsupported platform: ${platform} ${arch}`)
}

function getAssetPattern(): string {
  const p = detectPlatform()
  if (p === 'windows-latest') return 'printing_press.exe'
  return 'printing_press'
}

export async function resolveCompiler(): Promise<string | null> {
  // 1. Try local bundled compiler
  const local = join(COMPILER_DIR, COMPILER_NAME)
  const r1 = tryPath(local)
  if (r1) return r1

  // 2. Try INK_COMPILER env var
  const envCompiler = process.env['INK_COMPILER']
  if (envCompiler) {
    const r = tryPath(envCompiler)
    if (r) return r
  }

  // 3. Auto-download from GitHub releases
  return await downloadCompiler()
}

export async function downloadCompiler(): Promise<string> {
  mkdirSync(COMPILER_DIR, { recursive: true })

  console.log('Downloading Ink compiler from GitHub releases...')

  // Fetch latest release
  const releaseRes = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'Accept': 'application/vnd.github+json' }
  })
  if (!releaseRes.ok) {
    throw new Error(`Failed to fetch releases: ${releaseRes.status}`)
  }
  const release: GithubRelease = await releaseRes.json()

  // Find matching asset
  const pattern = getAssetPattern()
  const asset = release.assets.find(a => a.name === pattern)
  if (!asset) {
    throw new Error(`No asset found for platform: ${pattern}`)
  }

  // Download
  const binRes = await fetch(asset.browser_download_url)
  if (!binRes.ok) {
    throw new Error(`Failed to download compiler: ${binRes.status}`)
  }
  const buffer = await binRes.arrayBuffer()

  // Write
  const outPath = join(COMPILER_DIR, COMPILER_NAME)
  writeFileSync(outPath, Buffer.from(buffer))
  chmodSync(outPath, 0o755)

  console.log(`Compiler installed to ${outPath}`)
  return outPath
}
