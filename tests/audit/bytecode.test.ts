import { describe, it, expect } from 'vitest'
import { BytecodeScanner, BytecodeIssue } from '../../src/audit/bytecode.js'

describe('BytecodeScanner', () => {
  const scanner = new BytecodeScanner()

  it('returns empty for safe bytecode', () => {
    const safe: any = {
      instructions: [
        { op: 'ADD', args: [] },
        { op: 'CALL', args: ['print'] },
      ]
    }
    const issues = scanner.scan(safe)
    expect(issues).toEqual([])
  })

  it('detects file_write operation', () => {
    const bytecode: any = {
      instructions: [
        { op: 'FILE_WRITE', args: ['/plugins/ink/data.json', 'data'] }
      ]
    }
    const issues = scanner.scan(bytecode)
    expect(issues.length).toBe(1)
    expect(issues[0].op).toBe('FILE_WRITE')
    expect(issues[0].severity).toBe('warning')
  })

  it('detects http_request operation as blocked', () => {
    const bytecode: any = {
      instructions: [
        { op: 'HTTP_REQUEST', args: ['https://evil.com'] }
      ]
    }
    const issues = scanner.scan(bytecode)
    expect(issues.length).toBe(1)
    expect(issues[0].op).toBe('HTTP_REQUEST')
    expect(issues[0].severity).toBe('blocked')
  })

  it('detects multiple issues in same bytecode', () => {
    const bytecode: any = {
      instructions: [
        { op: 'FILE_WRITE', args: ['/tmp/x.txt'] },
        { op: 'HTTP_REQUEST', args: ['https://evil.com'] },
        { op: 'ADD', args: [] },
      ]
    }
    const issues = scanner.scan(bytecode)
    expect(issues.length).toBe(2)
  })

  it('handles null/undefined instructions gracefully', () => {
    expect(() => scanner.scan(null as any)).not.toThrow()
    expect(() => scanner.scan({})).not.toThrow()
    expect(scanner.scan({})).toEqual([])
  })
})
