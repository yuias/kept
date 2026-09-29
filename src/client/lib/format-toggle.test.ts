import { describe, expect, it } from 'vitest'
import { formatToCommit, nextFormat, showsDefault } from './format-toggle'

describe('nextFormat', () => {
  it('flips between the two concrete formats', () => {
    expect(nextFormat('formatted')).toBe('syntax')
    expect(nextFormat('syntax')).toBe('formatted')
  })
})

describe('formatToCommit', () => {
  it('commits nothing for an inherit note unless the toggle ends up away from the default', () => {
    expect(formatToCommit('inherit', null, 'formatted')).toBeNull()
    expect(formatToCommit('inherit', 'formatted', 'formatted')).toBeNull()
    expect(formatToCommit('inherit', 'syntax', 'formatted')).toBe('syntax')
    expect(formatToCommit('inherit', 'formatted', 'syntax')).toBe('formatted')
    expect(formatToCommit('inherit', 'syntax', 'syntax')).toBeNull()
  })

  it('compares against the saved format when it is concrete', () => {
    expect(formatToCommit('syntax', 'syntax', 'formatted')).toBeNull()
    expect(formatToCommit('syntax', 'formatted', 'formatted')).toBe('formatted')
    expect(formatToCommit('formatted', 'syntax', 'syntax')).toBe('syntax')
    expect(formatToCommit('syntax', null, 'formatted')).toBeNull()
  })
})

describe('showsDefault', () => {
  it('is true for inherit while nothing would be committed', () => {
    expect(showsDefault('inherit', null, 'formatted')).toBe(true)
    expect(showsDefault('inherit', 'formatted', 'formatted')).toBe(true)
  })

  it('is false for inherit once the pending format differs from the default', () => {
    expect(showsDefault('inherit', 'syntax', 'formatted')).toBe(false)
  })

  it('is false for any concrete saved format', () => {
    expect(showsDefault('formatted', null, 'formatted')).toBe(false)
    expect(showsDefault('syntax', 'syntax', 'formatted')).toBe(false)
    expect(showsDefault('syntax', 'formatted', 'formatted')).toBe(false)
  })
})
