import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMPLETIONS_DIR = join(__dirname, '../../completions')

const SHELLS = ['bash', 'zsh', 'fish'] as const
type Shell = typeof SHELLS[number]

export class CompletionsCommand {
  run(shell: string): void {
    if (!SHELLS.includes(shell as Shell)) {
      console.error(`Unknown shell "${shell}". Supported: ${SHELLS.join(', ')}`)
      console.error('Or output to a file:')
      console.error('  quill completions bash >> ~/.bashrc')
      console.error('  quill completions zsh  > ~/.zsh/completion/_quill')
      console.error('  quill completions fish > ~/.config/fish/completions/quill.fish')
      process.exit(1)
    }

    const file = join(COMPLETIONS_DIR, `quill.${shell}`)
    try {
      const content = readFileSync(file, 'utf-8')
      process.stdout.write(content)
    } catch {
      console.error(`Completion file not found: ${file}`)
      process.exit(1)
    }
  }
}
