import { createHash } from 'crypto'
import { createReadStream } from 'fs'

export interface VerifyResult {
  valid: boolean
  computed: string
  expected?: string
  error?: string
}

export class ChecksumVerifier {
  async verify(filePath: string, expected: string): Promise<VerifyResult> {
    const hash = createHash('sha256')
    const expectedClean = expected.replace(/^sha256:/, '')

    try {
      return await this.computeHash(filePath, hash, expectedClean)
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { valid: false, computed: '', error: `File ${filePath} does not exist` }
      }
      throw err
    }
  }

  private computeHash(filePath: string, hash: import('crypto').Hash, expected: string): Promise<VerifyResult> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => {
        const digest = hash.digest('hex')
        const computed = `sha256:${digest}`
        resolve({
          valid: digest === expected,
          computed,
          expected: `sha256:${expected}`,
        })
      })
      stream.on('error', reject)
    })
  }

  computeTarballSha256(buffer: Buffer): string {
    const hash = createHash('sha256')
    hash.update(buffer)
    return `sha256:${hash.digest('hex')}`
  }
}