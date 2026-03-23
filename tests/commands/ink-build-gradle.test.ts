// tests/commands/ink-build-gradle.test.ts
import { execSync, spawnSync } from 'child_process'
import { readFileSync, rmSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import { describe, it, expect, beforeEach } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '../../src/cli.js')
const FIXTURE = join(__dirname, '../fixtures/gradle-project')

describe('ink build with Gradle orchestration', () => {
  beforeEach(() => {
    try { rmSync(join(FIXTURE, 'dist'), { recursive: true }) } catch {}
  })

  it('runs gradlew and copies JAR to dist', () => {
    const result = execSync(
      `npx tsx ${CLI} build`,
      { cwd: FIXTURE, encoding: 'utf8' }
    )
    expect(result).toContain('Gradle build successful')
    expect(result).toContain('Runtime jar copied to dist/')

    // JAR was copied to dist
    expect(existsSync(join(FIXTURE, 'dist/ink.gradletest-0.1.0.jar'))).toBe(true)

    // ink-manifest.json has runtime
    const manifest = JSON.parse(readFileSync(join(FIXTURE, 'dist/ink-manifest.json'), 'utf8'))
    expect(manifest.runtime.jar).toBe('ink.gradletest-0.1.0.jar')
    expect(manifest.runtime.entry).toBe('ink.gradletest.GradletestRuntime')
  })

  it('reports Gradle error output when gradlew exits non-zero', () => {
    // Build a temporary fixture with a failing gradlew
    const tmpFixture = join(tmpdir(), `quill-gradle-fail-test-${Date.now()}`)
    const runtimeDir = join(tmpFixture, 'runtime')
    mkdirSync(runtimeDir, { recursive: true })
    mkdirSync(join(tmpFixture, 'src'), { recursive: true })

    // ink-package.toml
    writeFileSync(join(tmpFixture, 'ink-package.toml'), [
      '[package]',
      'name = "ink.failtest"',
      'version = "0.1.0"',
      'main = "mod"',
      '',
      '[runtime]',
      'jar = "runtime/build/libs/ink.failtest-0.1.0.jar"',
      'entry = "ink.failtest.FailtestRuntime"',
    ].join('\n'))

    // build.gradle.kts (just needs to exist to trigger Gradle path)
    writeFileSync(join(runtimeDir, 'build.gradle.kts'), '// placeholder\n')

    // gradlew that fails with a recognisable error message
    const gradlewContent = '#!/bin/bash\necho "GRADLE_ERROR: compilation failed" >&2\nexit 1\n'
    const gradlewPath = join(runtimeDir, 'gradlew')
    writeFileSync(gradlewPath, gradlewContent)
    chmodSync(gradlewPath, 0o755)

    // Run quill build; expect non-zero exit
    // shell: true is needed on Windows so that npx resolves correctly
    const proc = spawnSync('npx', ['tsx', CLI, 'build'], {
      cwd: tmpFixture,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: true,
    })

    expect(proc.status).not.toBe(0)
    const combined = (proc.stdout ?? '') + (proc.stderr ?? '')
    expect(combined).toContain('Gradle build failed')
    expect(combined).toContain('GRADLE_ERROR: compilation failed')

    // Cleanup
    try { rmSync(tmpFixture, { recursive: true }) } catch {}
  })
})
