export interface Vulnerability {
  id: string
  summary: string
  details?: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  references?: string[]
}

export interface VulnerabilityReport {
  package: string
  version: string
  vulnerabilities: Vulnerability[]
}

export class VulnerabilitiesScanner {
  /**
   * Query OSV.dev API for vulnerabilities affecting a given package+version.
   * Returns empty array if none found or on network error.
   */
  async scan(pkg: string, version: string): Promise<Vulnerability[]> {
    try {
      const res = await fetch('https://api.osv.dev/v1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package: { name: pkg, ecosystem: 'npm' },
          version,
        }),
      })
      if (!res.ok) return []
      const data = await res.json() as { vulns?: any[] }
      if (!data.vulns || data.vulns.length === 0) return []
      return data.vulns.map((v) => this.mapVuln(v))
    } catch {
      return []
    }
  }

  private mapVuln(v: any): Vulnerability {
    const severity = this.deriveSeverity(v)
    return {
      id: v.id ?? '',
      summary: v.summary ?? '',
      details: v.details,
      severity,
      references: v.references?.map((r: any) => r.url) ?? [],
    }
  }

  private deriveSeverity(v: any): Vulnerability['severity'] {
    // OSV severity can be a string or an array of severity objects
    // Example array: [{ type: 'CVSS_V3', score: 'CVSS:3.1/...' }]
    const severityArr = v.severity
    if (!severityArr) return 'MEDIUM'

    // Handle array case - extract score string
    let severityStr = ''
    if (Array.isArray(severityArr)) {
      // Prefer CVSS_V3, then fall back to any available
      const cvss = severityArr.find((s: any) => s.type === 'CVSS_V3')
      const s = cvss ?? severityArr[0]
      severityStr = typeof s === 'string' ? s : (s?.score ?? '')
    } else {
      severityStr = String(severityArr)
    }

    const upper = severityStr.toUpperCase()
    if (upper.includes('CRITICAL')) return 'CRITICAL'
    if (upper.includes('HIGH')) return 'HIGH'
    if (upper.includes('MEDIUM')) return 'MEDIUM'
    return 'LOW'
  }
}