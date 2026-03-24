import { RegistryClient } from '../registry/client.js'
import { generateKeyPair, fingerprint, writeRc, readRc } from '../util/keys.js'

export class LoginCommand {
  async run(): Promise<void> {
    const existing = readRc()
    if (existing.privateKey && existing.publicKey) {
      const fp = fingerprint(existing.publicKey)
      console.log(`Already logged in. Key fingerprint: ${fp}`)
      console.log('Run with --force to regenerate your keypair.')
      return
    }

    console.log('Generating Ed25519 keypair...')
    const kp = generateKeyPair()
    const fp = fingerprint(kp.publicKey)

    const client = new RegistryClient()
    console.log(`Registering public key with ${client.registryUrl}...`)

    const res = await fetch(`${client.registryUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: kp.publicKey, fingerprint: fp }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Registration failed (${res.status}): ${body}`)
      process.exit(1)
    }

    writeRc({ privateKey: kp.privateKey, publicKey: kp.publicKey })
    console.log(`Logged in. Key fingerprint: ${fp}`)
    console.log('Your keypair is saved to ~/.quillrc')
  }
}
