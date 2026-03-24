import { generateKeyPairSync, sign, verify, createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

export interface KeyPair {
  privateKey: string  // base64 PKCS8 DER
  publicKey: string   // base64 SPKI DER
}

export interface QuillRc {
  privateKey?: string
  publicKey?: string
  registry?: string
}

const rcPath = path.join(os.homedir(), '.quillrc')

export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    publicKeyEncoding: { type: 'spki', format: 'der' },
  })
  return {
    privateKey: (privateKey as Buffer).toString('base64'),
    publicKey: (publicKey as Buffer).toString('base64'),
  }
}

export function fingerprint(publicKeyB64: string): string {
  const der = Buffer.from(publicKeyB64, 'base64')
  return createHash('sha256').update(der).digest('hex').slice(0, 16)
}

export function signData(data: Buffer, privateKeyB64: string): string {
  const keyDer = Buffer.from(privateKeyB64, 'base64')
  const sig = sign(null, data, { key: keyDer, format: 'der', type: 'pkcs8' })
  return sig.toString('base64')
}

export function verifyData(data: Buffer, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const keyDer = Buffer.from(publicKeyB64, 'base64')
    const sig = Buffer.from(signatureB64, 'base64')
    return verify(null, data, { key: keyDer, format: 'der', type: 'spki' }, sig)
  } catch {
    return false
  }
}

export function readRc(): QuillRc {
  if (!fs.existsSync(rcPath)) return {}
  const content = fs.readFileSync(rcPath, 'utf8')
  const result: QuillRc = {}
  for (const line of content.split('\n')) {
    const m = line.match(/^(\w+)\s*=\s*(.+)$/)
    if (!m) continue
    if (m[1] === 'private_key') result.privateKey = m[2].trim()
    if (m[1] === 'public_key') result.publicKey = m[2].trim()
    if (m[1] === 'registry') result.registry = m[2].trim()
  }
  return result
}

export function writeRc(rc: QuillRc): void {
  const lines: string[] = []
  if (rc.privateKey) lines.push(`private_key = ${rc.privateKey}`)
  if (rc.publicKey) lines.push(`public_key = ${rc.publicKey}`)
  if (rc.registry) lines.push(`registry = ${rc.registry}`)
  fs.writeFileSync(rcPath, lines.join('\n') + '\n', { mode: 0o600 })
}
