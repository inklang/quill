import { cli } from './colors.js'

const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export class Spinner {
  private currentText = ''
  private frameIndex = 0
  private interval: NodeJS.Timeout | null = null
  private active = false

  start(text: string): void {
    this.stop()
    this.currentText = text
    this.frameIndex = 0
    this.active = true

    this.interval = setInterval(() => {
      if (!this.active) return
      process.stdout.write(`\r${cli.muted(SPINNER_CHARS[this.frameIndex])} ${this.currentText}`)
      this.frameIndex = (this.frameIndex + 1) % SPINNER_CHARS.length
    }, 80)
  }

  succeed(text: string): void {
    if (!this.active) return
    this.active = false
    this.stop()
    console.log(`${cli.success('✓')} ${text}`)
  }

  fail(text: string): void {
    if (!this.active) return
    this.active = false
    this.stop()
    console.error(`${cli.error('✗')} ${text}`)
  }

  stop(finalText?: string): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (finalText) {
      console.log(finalText)
    } else if (this.active) {
      // Clear the spinner line
      process.stdout.write('\r' + ' '.repeat(80) + '\r')
    }
    this.active = false
  }
}
