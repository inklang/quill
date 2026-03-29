import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SetupCommand } from '../../src/commands/setup.js'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'

describe('SetupCommand', () => {
  const tmpDir = join(os.tmpdir(), 'quill-setup-cmd-test')

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates server dir, ink-package.toml, and scripts dir', async () => {
    const serverPath = join(tmpDir, 'myserver')
    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()

    expect(existsSync(serverPath)).toBe(true)
    expect(existsSync(join(serverPath, 'eula.txt'))).toBe(true)

    const tomlPath = join(serverPath, 'ink-package.toml')
    expect(existsSync(tomlPath)).toBe(true)
    const content = readFileSync(tomlPath, 'utf-8')
    expect(content).toContain('name = "myserver"')
    expect(content).toContain('path = "."')

    expect(existsSync(join(serverPath, 'scripts'))).toBe(true)
  })

  it('uses existing server dir if valid', async () => {
    const serverPath = join(tmpDir, 'existing')
    mkdirSync(serverPath, { recursive: true })
    writeFileSync(join(serverPath, 'server.properties'), 'server-port=25565\n')

    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()

    expect(readFileSync(join(serverPath, 'server.properties'), 'utf-8')).toBe('server-port=25565\n')
    expect(existsSync(join(serverPath, 'ink-package.toml'))).toBe(true)
  })

  it('skips ink-package.toml if already exists', async () => {
    const serverPath = join(tmpDir, 'hasproject')
    mkdirSync(serverPath, { recursive: true })
    writeFileSync(join(serverPath, 'ink-package.toml'), '[package]\nname = "existing"\nversion = "1.0.0"\nmain = "main"\n')

    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()

    const content = readFileSync(join(serverPath, 'ink-package.toml'), 'utf-8')
    expect(content).toContain('name = "existing"')
  })

  it('skips Ink JAR download if already present', async () => {
    const serverPath = join(tmpDir, 'hasink')
    mkdirSync(join(serverPath, 'plugins'), { recursive: true })
    writeFileSync(join(serverPath, 'plugins', 'Ink.jar'), 'fake-jar')
    writeFileSync(join(serverPath, 'server.properties'), '')

    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()
    expect(readFileSync(join(serverPath, 'plugins', 'Ink.jar'), 'utf-8')).toBe('fake-jar')
  })

  it('sets server path to "." when project dir equals server dir', async () => {
    const serverPath = join(tmpDir, 'myserver')
    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()

    const content = readFileSync(join(serverPath, 'ink-package.toml'), 'utf-8')
    expect(content).toContain('path = "."')
  })

  it('sanitizes package name with special characters', async () => {
    const serverPath = join(tmpDir, 'My Server!')
    const cmd = new SetupCommand(serverPath, { skipPrompts: true })
    await cmd.run()

    const content = readFileSync(join(serverPath, 'ink-package.toml'), 'utf-8')
    expect(content).toContain('name = "my-server"')
  })
})
