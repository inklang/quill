// src/commands/ink-new.ts
import { TomlParser } from '../util/toml.js'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as readline from 'readline'

export class InkNewCommand {
  constructor(private projectDir: string) {}

  async run(): Promise<void> {
    const pkgName = await this.prompt('Package name (e.g. ink.mobs): ')
    // Basic validation — package names should be alphanumeric with dots/hyphens
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(pkgName)) {
      console.error(`Invalid package name: '${pkgName}'`)
      process.exit(1)
    }
    const grammarEntry = 'src/grammar.ts'
    const grammarOutput = 'dist/grammar.ir.json'

    // Create directory structure
    mkdirSync(join(this.projectDir, 'src'), { recursive: true })
    mkdirSync(join(this.projectDir, 'dist'), { recursive: true })

    // Write ink-package.toml
    const manifest = {
      name: pkgName,
      version: '0.1.0',
      entry: grammarEntry,
      dependencies: {},
      grammar: {
        entry: grammarEntry,
        output: grammarOutput,
      }
    }
    writeFileSync(
      join(this.projectDir, 'ink-package.toml'),
      TomlParser.write(manifest)
    )

    // Write starter grammar.ts
    const starterGrammar = `import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'

export default defineGrammar({
  package: '${pkgName}',
  declarations: [
    declaration({
      keyword: 'mykeyword',
      name: 'identifier',
      inheritsBase: true,
      rules: [
        rule('my_rule', r => r.identifier())
      ]
    })
  ]
})
`
    writeFileSync(join(this.projectDir, grammarEntry), starterGrammar)

    console.log(`Created new Ink grammar package: ${pkgName}`)
  }

  private prompt(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise(resolve => {
      rl.question(question + ' ', answer => {
        rl.close()
        resolve(answer)
      })
    })
  }
}
