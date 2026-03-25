import { describe, it, expect, vi } from 'vitest'
import { DoctorCommand } from '../../src/commands/doctor.js'

describe('quill doctor', () => {
  it('runs without crashing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)
    await new DoctorCommand().run()
    exitSpy.mockRestore()
  })

  it('outputs JSON when --json is passed', async () => {
    let output = ''
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg) => { output = msg })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any)

    await new DoctorCommand().run(true)

    logSpy.mockRestore()
    exitSpy.mockRestore()
    // Should be valid JSON
    expect(() => JSON.parse(output as string)).not.toThrow()
  })
})
