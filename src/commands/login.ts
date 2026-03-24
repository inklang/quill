import { RegistryClient } from '../registry/client.js'
import { writeRc, readRc, clearRc } from '../util/keys.js'

export class LogoutCommand {
  run(): void {
    const existing = readRc()
    if (!existing) {
      console.log('Not logged in.')
      return
    }
    clearRc()
    console.log(`Logged out. Removed credentials from ~/.quillrc`)
  }
}

export class LoginCommand {
  async run(): Promise<void> {
    const existing = readRc()
    if (existing) {
      console.log(`Already logged in as ${existing.username}`)
      console.log('Run with --force to re-authenticate.')
      return
    }

    const client = new RegistryClient()
    console.log(`Opening browser to authenticate with ${client.registryUrl}...`)

    // TODO: Implement browser-based OAuth callback flow
    // For now, this is a placeholder
    console.log('Token-based authentication coming soon.')
    process.exit(1)
  }
}
