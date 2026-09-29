import { describe, expect, it } from 'vitest'
import { minimalChange } from './sync'

function apply(text: string, c: { from: number; to: number; insert: string }): string {
  return text.slice(0, c.from) + c.insert + text.slice(c.to)
}

describe('minimalChange', () => {
  it.each([
    ['hello world', 'hello brave world'],
    ['abc', 'abc'],
    ['', 'new'],
    ['gone', ''],
    ['aaa', 'aa'],
    ['a\nb', 'a\nxb'],
  ])('round-trips %j to %j', (from, to) => {
    expect(apply(from, minimalChange(from, to))).toBe(to)
  })

  it('touches only the differing middle', () => {
    expect(minimalChange('hello world', 'hello brave world')).toEqual({ from: 6, to: 6, insert: 'brave ' })
  })
})
