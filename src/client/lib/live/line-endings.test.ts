import { describe, expect, it } from 'vitest'
import { toLf } from './line-endings'

describe('toLf', () => {
  it('converts CRLF and lone CR to LF', () => {
    expect(toLf('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('leaves LF-only text unchanged', () => {
    expect(toLf('a\n\nb')).toBe('a\n\nb')
  })
})
