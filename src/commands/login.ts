import http from 'http'
import net from 'net'
import { exec } from 'child_process'
import { readRc, writeRc, clearRc } from '../util/keys.js'

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

export class LoginCommand {
  async run(): Promise<void> {
    const registry = process.env['QUILL_REGISTRY'] ?? 'https://lectern.inklang.org'
    const port = await getFreePort()
    const callbackUrl = `http://127.0.0.1:${port}/callback`
    const authUrl = `${registry}/cli-auth?callback=${encodeURIComponent(callbackUrl)}`

    console.log(`Opening browser to log in...`)
    console.log(`If the browser doesn't open, visit: ${authUrl}`)
    openBrowser(authUrl)

    const result = await new Promise<{ token: string; username: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close()
        reject(new Error('Login timed out after 5 minutes'))
      }, 5 * 60 * 1000)

      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
        const token = url.searchParams.get('token')
        const username = url.searchParams.get('username')

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>Logged in! You can close this tab.</p></body></html>')

        clearTimeout(timeout)
        server.close()

        if (!token || !username) {
          reject(new Error('Missing token or username in callback'))
        } else {
          resolve({ token, username })
        }
      })

      server.listen(port, '127.0.0.1')
    })

    writeRc({ token: result.token, username: result.username, registry })
    console.log(`Logged in as ${result.username}`)
  }
}

export class LogoutCommand {
  run(): void {
    const registry = process.env['QUILL_REGISTRY'] ?? 'https://lectern.inklang.org'
    const rc = readRc()

    // Best-effort server-side revocation (fire and forget)
    if (rc?.token) {
      fetch(`${registry}/api/auth/token`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${rc.token}` }
      }).catch(() => {})
    }

    clearRc()
    console.log('Logged out.')
  }
}
