import http from 'http'
import net from 'net'
import { exec } from 'child_process'
import { readRc, writeRc, clearRc, generateKeypair, makeAuthHeader } from '../util/keys.js'

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`
  exec(cmd)
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo
      srv.close(() => resolve(addr.port))
    })
    srv.on('error', reject)
  })
}

export interface LoginOptions {
  token?: string
  username?: string
}

export class LoginCommand {
  async run(options: LoginOptions = {}): Promise<void> {
    const registry = process.env['QUILL_REGISTRY'] ?? 'https://lectern.inklang.org'

    // Keypair-only login for CI environments
    if (options.token && options.username) {
      // options.token is treated as a pre-generated keyId:privateKeyB64 pair (base64url encoded JSON)
      // For simplicity, generate a fresh keypair and register it with the registry using the provided token as a Bearer
      const { keyId, privateKeyB64, publicKeyB64 } = generateKeypair()
      const res = await fetch(`${registry}/api/auth/cli-token`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${options.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: publicKeyB64 }),
      })
      if (!res.ok) throw new Error(`Failed to register key: ${res.status} ${await res.text()}`)
      const { username } = await res.json() as { username: string }
      writeRc({ keyId, privateKey: privateKeyB64, username: options.username ?? username, registry })
      console.log(`Logged in as ${options.username ?? username}`)
      return
    }

    if (options.token || options.username) {
      console.error('Error: both --token and --username must be provided together.')
      process.exit(1)
    }

    // Browser-based login
    const port = await getFreePort()
    const callbackUrl = `http://127.0.0.1:${port}/callback`
    const authUrl = `${registry}/cli-auth?callback=${encodeURIComponent(callbackUrl)}`

    console.log(`Opening browser to log in...`)
    console.log(`If the browser doesn't open, visit: ${authUrl}`)
    openBrowser(authUrl)

    // Generate keypair before the browser opens so it's ready to register
    const { keyId, privateKeyB64, publicKeyB64 } = generateKeypair()

    const result = await new Promise<{ accessToken: string; username: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close()
        reject(new Error('Login timed out after 5 minutes'))
      }, 5 * 60 * 1000)

      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
        const accessToken = url.searchParams.get('access_token')
        const username = url.searchParams.get('username')

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>Logged in! You can close this tab.</p></body></html>')

        clearTimeout(timeout)
        server.close()

        if (!accessToken || !username) {
          reject(new Error('Missing access_token or username in callback'))
        } else {
          resolve({ accessToken, username })
        }
      })

      server.listen(port, '127.0.0.1')
    })

    // Register the public key with Lectern
    const res = await fetch(`${registry}/api/auth/cli-token`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${result.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: publicKeyB64 }),
    })
    if (!res.ok) throw new Error(`Failed to register keypair: ${res.status} ${await res.text()}`)

    writeRc({ keyId, privateKey: privateKeyB64, username: result.username, registry })
    console.log(`Logged in as ${result.username}`)
  }
}

export class LogoutCommand {
  async run(): Promise<void> {
    const registry = process.env['QUILL_REGISTRY'] ?? 'https://lectern.inklang.org'
    const rc = readRc()

    if (rc?.keyId && rc?.privateKey) {
      try {
        const authHeader = makeAuthHeader(rc.keyId, rc.privateKey)
        const res = await fetch(`${registry}/api/auth/token`, {
          method: 'DELETE',
          headers: { 'Authorization': authHeader }
        })
        if (!res.ok) {
          console.warn(`Warning: Server key revocation failed (${res.status}). Key cleared locally.`)
        }
      } catch (e: any) {
        console.warn(`Warning: Could not revoke server key (${e.message}). Key cleared locally.`)
      }
    }

    clearRc()
    console.log('Logged out.')
  }
}
