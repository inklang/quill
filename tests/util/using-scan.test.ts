import { describe, it, expect } from 'vitest'
import { scanUsingDeclarations } from '../../src/util/using-scan.js'

describe('scanUsingDeclarations', () => {
  it('extracts single using declaration', () => {
    const source = `using ink.mobs\n\nmob Zombie {\n  on_damage {}\n}`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual([{ package: 'ink.mobs' }])
  })

  it('extracts multiple using declarations', () => {
    const source = `using ink.mobs\nusing ink.commands\n\nmob Zombie {}`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual([{ package: 'ink.mobs' }, { package: 'ink.commands' }])
  })

  it('returns empty array when no using declarations', () => {
    const source = `print("hello")`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual([])
  })

  it('only extracts using at start of file', () => {
    const source = `print("hi")\nusing ink.mobs`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual([])
  })

  it('stops at first non-using non-blank line', () => {
    const source = `using ink.mobs\nprint("hello")\nusing ink.late`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual([{ package: 'ink.mobs' }])
  })

  it('captures alias from using ... as ...', () => {
    const source = `using ink.mythic-mobs as mythic\n\nmob Zombie {}`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual([{ package: 'ink.mythic-mobs', alias: 'mythic' }])
  })

  it('handles mixed aliased and unaliased declarations', () => {
    const source = `using ink.mobs\nusing ink.mythic-mobs as mythic\n\nmob Zombie {}`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual([
      { package: 'ink.mobs' },
      { package: 'ink.mythic-mobs', alias: 'mythic' },
    ])
  })

  it('handles hyphenated alias names', () => {
    const source = `using ink.custom-mobs as custom-m\n\nmob Zombie {}`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual([{ package: 'ink.custom-mobs', alias: 'custom-m' }])
  })

  it('allows trailing whitespace after using declaration', () => {
    const source = `using ink.mobs   \nusing ink.extra as ex  \n\nmob Zombie {}`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual([{ package: 'ink.mobs' }, { package: 'ink.extra', alias: 'ex' }])
  })
})
