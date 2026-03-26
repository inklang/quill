export interface BytecodeIssue {
  op: string
  args: unknown[]
  severity: 'warning' | 'blocked'
  message: string
}

const DISALLOWED: Record<string, { severity: 'warning' | 'blocked'; message: string }> = {
  FILE_READ: {
    severity: 'warning',
    message: 'file_read operation detected — filesystem access in published bytecode',
  },
  FILE_WRITE: {
    severity: 'warning',
    message: 'file_write operation detected — filesystem write in published bytecode',
  },
  HTTP_REQUEST: {
    severity: 'blocked',
    message: 'http_request operation detected — outbound network calls are not allowed in published packages',
  },
  EXEC: {
    severity: 'blocked',
    message: 'exec operation detected — arbitrary code execution is not allowed',
  },
  EVAL: {
    severity: 'blocked',
    message: 'eval operation detected — dynamic evaluation is not allowed',
  },
  DB_WRITE: {
    severity: 'blocked',
    message: 'db_write operation detected — database writes are not allowed in published packages',
  },
}

export class BytecodeScanner {
  scan(bytecode: any): BytecodeIssue[] {
    const issues: BytecodeIssue[] = []
    const instructions = bytecode?.instructions
    if (!Array.isArray(instructions)) return issues

    for (const instr of instructions) {
      if (!instr || typeof instr !== 'object') continue
      const op = instr.op?.toUpperCase()
      const rule = DISALLOWED[op]
      if (rule) {
        issues.push({
          op,
          args: instr.args ?? [],
          severity: rule.severity,
          message: rule.message,
        })
      }
    }

    return issues
  }
}
