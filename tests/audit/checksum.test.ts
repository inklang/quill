import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ChecksumVerifier } from '../../src/audit/checksum.js'

describe('ChecksumVerifier', () => {
  let verifier: ChecksumVerifier
  let tmp: string

  beforeEach(() => {
    verifier = new ChecksumVerifier()
    tmp = join(tmpdir(), `quill-checksum-test-${Date.now()}-${Math.random()}`)
    mkdirSync(tmp, { recursive: true })
  })

  function sha256(data: string): string {
    return createHash('sha256').update(data).digest('hex')
  }

  it('passes when computed checksum matches expected', async () => {
    const content = 'hello world'
    const expected = sha256(content)
    const filePath = join(tmp, 'file.txt')
    writeFileSync(filePath, content)

    const result = await verifier.verify(filePath, expected)
    expect(result.valid).toBe(true)
    expect(result.computed).toBe(`sha256:${expected}`)
  })

  it('fails when checksum does not match', async () => {
    const content = 'hello world'
    const wrong = sha256('different content')
    const filePath = join(tmp, 'file.txt')
    writeFileSync(filePath, content)

    const result = await verifier.verify(filePath, wrong)
    expect(result.valid).toBe(false)
    expect(result.computed).toBe(`sha256:${sha256(content)}`)
    expect(result.expected).toBe(`sha256:${wrong}`)
  })

  it('handles missing file gracefully', async () => {
    const result = await verifier.verify(join(tmp, 'nonexistent.txt'), 'sha256:abc')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('does not exist')
  })

  it('handles sha256: prefix in expected value', async () => {
    const content = 'test'
    const hash = sha256(content)
    const filePath = join(tmp, 'file.txt')
    writeFileSync(filePath, content)

    const result = await verifier.verify(filePath, `sha256:${hash}`)
    expect(result.valid).toBe(true)
  })

  it('normalizes sha256: prefix for comparison', async () => {
    const content = 'test'
    const hash = sha256(content)
    const filePath = join(tmp, 'file.txt')
    writeFileSync(filePath, content)

    const result1 = await verifier.verify(filePath, `sha256:${hash}`)
    const result2 = await verifier.verify(filePath, hash)
    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(true)
  })
})