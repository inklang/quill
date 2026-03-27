import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export class PackCommand {
  private projectDir: string
  private manifest: any
  private grammar: any

  constructor(projectDir: string = process.cwd()) {
    this.projectDir = projectDir
  }

  validate(): void {
    const manifestPath = join(this.projectDir, 'ink.pkg')
    if (!existsSync(manifestPath)) {
      throw new Error(`Missing ink.pkg in ${this.projectDir}`)
    }

    this.manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

    const grammarPath = join(this.projectDir, this.manifest.grammar)
    if (!existsSync(grammarPath)) {
      throw new Error(`Missing grammar file: ${this.manifest.grammar}`)
    }

    this.grammar = JSON.parse(readFileSync(grammarPath, 'utf-8'))

    // Validate provides matches keywords
    const provides = new Set(this.manifest.provides ?? [])
    const keywords = new Set(this.grammar.keywords ?? [])

    if (provides.size !== keywords.size || ![...provides].every(k => keywords.has(k))) {
      throw new Error(
        `ink.pkg provides [${[...provides]}] does not match grammar.json keywords [${[...keywords]}]`
      )
    }

    // Validate runtime JAR exists if runtime is specified
    if (this.manifest.runtime) {
      const jarPath = join(this.projectDir, this.manifest.runtime.jar)
      if (!existsSync(jarPath)) {
        throw new Error(
          `Runtime JAR not found: ${this.manifest.runtime.jar}. Build it first.`
        )
      }
    }
  }

  async run(): Promise<void> {
    this.validate()
    console.log(`Package ${this.manifest.name}@${this.manifest.version} validated`)
  }
}
