import { describe, expect, it } from 'vitest'
import { cardMarkup, parseCardLine } from './link-card'

describe('parseCardLine', () => {
  it('accepts a plain https card', () => {
    expect(parseCardLine('@[card](https://example.com)')).toBe('https://example.com')
  })

  it('accepts http with a query and trailing whitespace', () => {
    expect(parseCardLine('@[card](http://a.b/c?d=1)   ')).toBe('http://a.b/c?d=1')
    expect(parseCardLine('@[card](http://a.b/c?d=1)\t')).toBe('http://a.b/c?d=1')
  })

  it('keeps balanced parentheses in the URL', () => {
    expect(parseCardLine('@[card](https://en.wikipedia.org/wiki/Foo_(bar))')).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    )
  })

  it('rejects a leading space', () => {
    expect(parseCardLine(' @[card](https://example.com)')).toBeNull()
  })

  it('rejects text before or after the card', () => {
    expect(parseCardLine('x @[card](https://example.com)')).toBeNull()
    expect(parseCardLine('@[card](https://example.com) x')).toBeNull()
  })

  it('rejects non-http(s) schemes', () => {
    expect(parseCardLine('@[card](ftp://example.com)')).toBeNull()
    expect(parseCardLine('@[card](javascript:alert(1))')).toBeNull()
  })

  it('rejects relative and empty URLs', () => {
    expect(parseCardLine('@[card](/relative)')).toBeNull()
    expect(parseCardLine('@[card](example.com)')).toBeNull()
    expect(parseCardLine('@[card]()')).toBeNull()
  })

  it('is case-sensitive about the card label', () => {
    expect(parseCardLine('@[Card](https://example.com)')).toBeNull()
  })
})

describe('cardMarkup', () => {
  it('wraps a simple URL', () => {
    expect(cardMarkup('https://example.com/a')).toBe('@[card](https://example.com/a)')
  })

  it('keeps balanced parentheses verbatim', () => {
    expect(cardMarkup('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe(
      '@[card](https://en.wikipedia.org/wiki/Foo_(bar))',
    )
  })

  it('encodes every parenthesis when they are unbalanced', () => {
    expect(cardMarkup('https://a.example/x)y')).toBe('@[card](https://a.example/x%29y)')
    expect(cardMarkup('https://a.example/(x')).toBe('@[card](https://a.example/%28x)')
    expect(cardMarkup('https://a.example/)(')).toBe('@[card](https://a.example/%29%28)')
  })

  it('round-trips through parseCardLine', () => {
    for (const url of ['https://a.example/x', 'https://a.example/F_(b)', 'https://a.example/x)y']) {
      expect(parseCardLine(cardMarkup(url))).not.toBeNull()
    }
  })
})
