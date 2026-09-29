import { describe, expect, it } from 'vitest'
import { requiredLiteral } from './regex-literal'

describe('requiredLiteral', () => {
  it('takes the first run on a length tie', () => {
    expect(requiredLiteral('foo\\d+bar', '')).toBe('foo')
  })

  it('prefers a longer later run', () => {
    expect(requiredLiteral('ab\\d+cdef', '')).toBe('cdef')
  })

  it('returns null when an optional atom splits the runs below 3', () => {
    expect(requiredLiteral('ab?c', '')).toBeNull()
  })

  it('returns null for a pattern that is only a group', () => {
    expect(requiredLiteral('(abc)', '')).toBeNull()
  })

  it('returns null for a top-level alternation', () => {
    expect(requiredLiteral('a|bcd', '')).toBeNull()
  })

  it('ignores an alternation inside a group', () => {
    expect(requiredLiteral('foo(a|b)bar!', '')).toBe('bar!')
  })

  it('returns an escaped literal run', () => {
    expect(requiredLiteral('\\.json$', '')).toBe('.json')
  })

  it('skips a non-ASCII run when i is set', () => {
    expect(requiredLiteral('é+xyz', 'i')).toBe('xyz')
  })

  it('returns null when the longest run is non-ASCII and i is set', () => {
    expect(requiredLiteral('日本語テキスト', 'i')).toBeNull()
  })

  it('keeps a non-ASCII run without i', () => {
    expect(requiredLiteral('日本語', '')).toBe('日本語')
  })

  it('drops the last char of a run made optional by * or ?', () => {
    expect(requiredLiteral('abcd*', '')).toBe('abc')
    expect(requiredLiteral('abcd?', '')).toBe('abc')
    expect(requiredLiteral('abcd{0,2}', '')).toBe('abc')
  })

  it('keeps the whole run when + or a positive count follows', () => {
    expect(requiredLiteral('abcd+', '')).toBe('abcd')
    expect(requiredLiteral('abcd{2}', '')).toBe('abcd')
  })

  it('drops a whole astral character when it becomes optional', () => {
    expect(requiredLiteral('abc😀?', '')).toBe('abc')
  })

  it('splits runs at wildcards, classes and class escapes', () => {
    expect(requiredLiteral('ab.cde', '')).toBe('cde')
    expect(requiredLiteral('ab[xyz]cde', '')).toBe('cde')
    expect(requiredLiteral('ab\\scde', '')).toBe('cde')
  })

  it('does not treat a class body as literal text', () => {
    expect(requiredLiteral('[abcdef]', '')).toBeNull()
  })

  it('treats a lazy quantifier suffix as part of the quantifier', () => {
    expect(requiredLiteral('abc+?def', '')).toBe('abc')
  })

  it('treats a lone brace as a literal', () => {
    expect(requiredLiteral('a{,3}b', '')).toBe('a{,3}b')
  })

  it('returns null when a hex or unicode escape is present', () => {
    expect(requiredLiteral('abc\\x41def', '')).toBeNull()
    expect(requiredLiteral('abc\\u0041def', '')).toBeNull()
  })

  it('returns null for runs shorter than 3', () => {
    expect(requiredLiteral('ab', '')).toBeNull()
  })

  it('returns null under iu when the run contains k or s', () => {
    expect(requiredLiteral('kiosk', 'iu')).toBeNull()
    expect(requiredLiteral('abcs', 'iu')).toBeNull()
    expect(requiredLiteral('ABCK', 'iu')).toBeNull()
    expect(requiredLiteral('abcd', 'iu')).toBe('abcd')
  })

  it('only applies the k/s rule when both i and u are set', () => {
    expect(requiredLiteral('kiosk', 'i')).toBe('kiosk')
    expect(requiredLiteral('kiosk', 'u')).toBe('kiosk')
  })

  it('treats every digit after a backslash as part of the escape', () => {
    expect(requiredLiteral('\\0123', '')).toBeNull()
    expect(requiredLiteral('\\1234', '')).toBeNull()
  })

  it('ends the run at a multi-digit backreference', () => {
    const source = '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\\10xyz'
    for (const flags of ['', 'u']) {
      const literal = requiredLiteral(source, flags)
      expect(literal).toBe('xyz')
      expect(new RegExp(source, flags).test('abcdefghijjxyz')).toBe(true)
      expect('abcdefghijjxyz'.includes(literal!)).toBe(true)
    }
  })

  it('keeps a literal run before a backreference', () => {
    expect(requiredLiteral('(a)abc\\1', '')).toBe('abc')
  })
})
