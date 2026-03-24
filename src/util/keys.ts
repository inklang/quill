import fs from 'fs'
import os from 'os'
import path from 'path'

const RC_PATH = path.join(os.homedir(), '.quillrc')

export interface QuillRc {
  token: string
  username: string
  registry: string
}

export function readRc(): QuillRc | null {
  try {
    const raw = fs.readFileSync(RC_PATH, 'utf8')
    return JSON.parse(raw) as QuillRc
  } catch {
    return null
  }
}

export function writeRc(rc: QuillRc): void {
  fs.writeFileSync(RC_PATH, JSON.stringify(rc, null, 2), { mode: 0o600 })
}

export function clearRc(): void {
  try { fs.unlinkSync(RC_PATH) } catch {}
}
