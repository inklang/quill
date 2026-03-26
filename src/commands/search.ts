import { RegistryClient } from '../registry/client.js'

const RESULTS_PER_PAGE = 10

export class SearchCommand {
  async run(query: string, page: number = 1, outputJson: boolean = false): Promise<void> {
    if (!query.trim()) {
      console.error('error: Search query required')
      process.exit(1)
    }

    const client = new RegistryClient()
    try {
      const results = await client.searchPackages(query)

      if (outputJson) {
        console.log(JSON.stringify(results, null, 2))
        return
      }

      if (results.length === 0) {
        console.log(`No packages found matching "${query}"`)
        return
      }

      // Paginate
      const start = (page - 1) * RESULTS_PER_PAGE
      const end = start + RESULTS_PER_PAGE
      const pageResults = results.slice(start, end)

      const termWidth = process.stdout.columns || 80
      for (const r of pageResults) {
        const nameVer = `${r.name}@${r.version}`
        const pad = 20
        const descLen = termWidth - pad - 3
        const desc = r.description.slice(0, Math.max(0, descLen))
        console.log(`${nameVer.padEnd(pad)}${desc}`)
      }

      const totalPages = Math.ceil(results.length / RESULTS_PER_PAGE)
      if (totalPages > 1) {
        console.log(`\nPage ${page} of ${totalPages} (${results.length} results)`)
      }
    } catch (e: any) {
      console.error(`error: Failed to search registry: ${e.message}`)
      process.exit(1)
    }
  }
}
