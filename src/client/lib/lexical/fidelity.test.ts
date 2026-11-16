import { describe, expect, it } from 'vitest'
import { classifyRoundTrip } from './fidelity'

describe('classifyRoundTrip', () => {
  it('rates byte-equal strings identical', () => {
    expect(classifyRoundTrip('a\n\nb\n', 'a\n\nb\n')).toBe('identical')
    expect(classifyRoundTrip('', '')).toBe('identical')
  })

  it('rates a different bullet marker render-equal', () => {
    expect(classifyRoundTrip('* a', '- a')).toBe('render-equal')
  })

  it('rates an unnecessary escape render-equal', () => {
    expect(classifyRoundTrip('foo\\_bar', 'foo_bar')).toBe('render-equal')
  })

  it('rates a setext heading versus a rule render-different', () => {
    expect(classifyRoundTrip('a\n---', 'a\n\n---')).toBe('render-different')
  })
})
