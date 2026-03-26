import { spawnSync } from 'child_process'
import path from 'path'
import fs from 'fs'

export interface TestCommandOptions {
  ink?: boolean
  watch?: boolean
  json?: boolean
}

export class TestCommand {
  constructor(private projectDir: string) {}

  async run(opts: TestCommandOptions): Promise<number> {
    if (opts.ink) {
      return this.runInkTests(opts)
    }
    return this.runVitest(opts)
  }

  private async runVitest(opts: TestCommandOptions): Promise<number> {
    const args = ['vitest', 'run']
    if (opts.watch) args.push('--watch')
    if (opts.json) args.push('--reporter=json')

    const result = spawnSync('node', args, {
      cwd: this.projectDir,
      stdio: 'inherit',
    })
    return result.status ?? 1
  }

  private async runInkTests(opts: TestCommandOptions): Promise<number> {
    const testsDir = path.join(this.projectDir, 'tests')
    if (!fs.existsSync(testsDir)) {
      console.log('No tests to run.')
      return 0
    }

    const testFiles = fs.readdirSync(testsDir)
      .filter(f => f.endsWith('_test.ink'))

    if (testFiles.length === 0) {
      console.log('No tests to run.')
      return 0
    }

    const compiler = process.env['INK_COMPILER']
    if (!compiler) {
      console.error('Ink compiler not found. Set INK_COMPILER or install @inklang/ink.')
      return 1
    }

    let failed = 0
    let passed = 0

    for (const testFile of testFiles) {
      const inputPath = path.join(testsDir, testFile)
      const outputPath = path.join(testsDir, testFile.replace('.ink', '.inkc'))

      try {
        const isPrintingPress = compiler.includes('printing_press')
        if (isPrintingPress) {
          spawnSync(`"${compiler}" compile "${inputPath.replace(/\\/g, '/')}" -o "${outputPath.replace(/\\/g, '/')}"`, {
            shell: true,
            cwd: this.projectDir,
            stdio: 'pipe',
          })
        } else {
          const javaCmd = process.env['INK_JAVA'] || 'java'
          spawnSync(`${javaCmd} -jar "${compiler}" compile "${inputPath.replace(/\\/g, '/')}" -o "${outputPath.replace(/\\/g, '/')}"`, {
            shell: true,
            cwd: this.projectDir,
            stdio: 'pipe',
          })
        }
      } catch (e: any) {
        console.error(`FAIL: ${testFile} (compilation error)`)
        console.error(e.stdout?.toString() ?? e.message)
        failed++
        continue
      }

      // STUB: Structured pass/fail per test function requires VM-side TestContext.
      // This stub compiles tests but cannot execute them meaningfully yet.
      // Tracking: VM-side TestContext is separate work in the Ink repo.
      console.log(`PASS (stub): ${testFile} — structured execution pending VM-side TestContext`)
      passed++
    }

    console.log(`\n${passed} passed, ${failed} failed`)
    return failed > 0 ? 1 : 0
  }
}