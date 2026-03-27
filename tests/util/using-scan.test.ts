import { describe, it, expect } from 'vitest'
import { scanUsingDeclarations } from '../../src/util/using-scan.js'

describe('scanUsingDeclarations', () => {
  it('extracts single using declaration', () => {
    const source = `using ink.mobs\n\nmob Zombie {\n  on_damage {}\n}`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual(['ink.mobs'])
  })

  it('extracts multiple using declarations', () => {
    const source = `using ink.mobs\nusing ink.commands\n\nmob Zombie {}`
    const result = scanUsingDeclarations(source)
    expect(result).toEqual(['ink.mobs', 'ink.commands'])
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
    expect(result).toEqual(['ink.mobs'])
  })
})
