import { describe, expect, it } from 'vitest'
import { insertAt, makePlaceholder, placeholderRange, replacePlaceholder } from './insert'

describe('makePlaceholder', () => {
  it('returns an image markdown placeholder with an empty target', () => {
    expect(makePlaceholder()).toMatch(/^!\[uploading-.+\]\(\)$/)
  })

  it('returns a different token on each call', () => {
    expect(makePlaceholder()).not.toBe(makePlaceholder())
  })
})

describe('insertAt', () => {
  it('inserts in the middle of the text', () => {
    expect(insertAt('hello world', 5, 'XXX')).toBe('helloXXX world')
  })

  it('inserts at the start', () => {
    expect(insertAt('hello', 0, 'XXX')).toBe('XXXhello')
  })

  it('inserts at the end', () => {
    expect(insertAt('hello', 5, 'XXX')).toBe('helloXXX')
  })

  it('clamps a negative position to the start', () => {
    expect(insertAt('hello', -5, 'XXX')).toBe('XXXhello')
  })

  it('clamps a position past the end to the end', () => {
    expect(insertAt('hello', 999, 'XXX')).toBe('helloXXX')
  })
})

describe('replacePlaceholder', () => {
  it('replaces the token with the given markdown', () => {
    expect(replacePlaceholder('a ![uploading-1]() b', '![uploading-1]()', '![](/img/x)')).toBe('a ![](/img/x) b')
  })

  it('removes the token when markdown is empty', () => {
    expect(replacePlaceholder('a ![uploading-1]() b', '![uploading-1]()', '')).toBe('a  b')
  })

  it('only replaces the first occurrence', () => {
    const text = '![uploading-1]() and ![uploading-1]()'
    expect(replacePlaceholder(text, '![uploading-1]()', 'X')).toBe('X and ![uploading-1]()')
  })

  it('returns the text unchanged when the token is not present', () => {
    expect(replacePlaceholder('no token here', '![uploading-1]()', 'X')).toBe('no token here')
  })
})

describe('placeholderRange', () => {
  it('locates the first occurrence', () => {
    expect(placeholderRange('a ![uploading-1]() b ![uploading-1]()', '![uploading-1]()')).toEqual({ from: 2, to: 18 })
  })

  it('returns null when the token is gone', () => {
    expect(placeholderRange('nothing', '![uploading-1]()')).toBeNull()
  })
})
