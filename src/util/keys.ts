import fs from 'fs'
import os from 'os'
import path from 'path'
import { generateKeyPairSync, createHash, sign as cryptoSign, verify as cryptoVerify } from 'crypto'

const RC_PATH = path.join(os.homedir(), '.quillrc')

export interface QuillRc {
  keyId: string
  privateKey: string  // PKCS8 DER base64
  username: string
  registry: string
}

export function generateKeypair(): { keyId: string; privateKeyB64: string; publicKeyB64: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
  const privateKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' })
  const keyId = createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32)
  return {
    keyId,
    privateKeyB64: (privateKeyDer as Buffer).toString('base64'),
    publicKeyB64: (publicKeyDer as Buffer).toString('base64'),
  }
}

export function makeAuthHeader(keyId: string, privateKeyB64: string): string {
  const ts = Date.now().toString()
  const payload = Buffer.from(`${keyId}:${ts}`)
  const privDer = Buffer.from(privateKeyB64, 'base64')
  const sig = cryptoSign(null, payload, { key: privDer, format: 'der', type: 'pkcs8' })
  return `Ink-v1 keyId=${keyId},ts=${ts},sig=${sig.toString('base64')}`
}

export function verifyAuthHeader(header: string, publicKeyB64: string): boolean {
  const m = header.match(/^Ink-v1 keyId=([^,]+),ts=(\d+),sig=(.+)$/)
  if (!m) return false
  const [, keyId, ts, sigB64] = m
  const age = Math.abs(Date.now() - parseInt(ts))
  if (age > 5 * 60 * 1000) return false  // 5 min window
  const payload = Buffer.from(`${keyId}:${ts}`)
  const sig = Buffer.from(sigB64, 'base64')
  const pubDer = Buffer.from(publicKeyB64, 'base64')
  try {
    return cryptoVerify(null, payload, { key: pubDer, format: 'der', type: 'spki' }, sig)
  } catch {
    return false
  }
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
