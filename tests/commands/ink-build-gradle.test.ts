// tests/commands/ink-build-gradle.test.ts
import { execSync } from 'child_process'
import { readFileSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
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
})
