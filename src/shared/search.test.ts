import { describe, expect, it } from 'vitest'
import { SEARCH_ATOMS_MAX } from './limits'
import { parseSearch, type SearchQuery } from './search'

function groupsOf(query: SearchQuery): unknown[][] {
  return query.groups.map((group) => group.map((atom) => (atom.kind === 'text' ? atom.value : `label:${atom.value}`)))
}

describe('parseSearch', () => {
  it('ANDs plain words', () => {
    const result = parseSearch('a b')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['a'], ['b']])
  })

  it('binds OR tighter than the implicit AND', () => {
    const result = parseSearch('a OR b c')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['a', 'b'], ['c']])
  })

  it('binds OR on the other side too', () => {
    const result = parseSearch('a b OR c')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['a'], ['b', 'c']])
  })

  it('parses a quoted phrase OR a label atom as one OR-group', () => {
    const result = parseSearch('"x y" OR label:foo')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['x y', 'label:foo']])
  })

  it('parses a quoted label value', () => {
    const result = parseSearch('label:"a b"')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['label:a b']])
  })

  it('treats a lowercase or as a word, not an operator', () => {
    const result = parseSearch('a or b')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['a'], ['or'], ['b']])
  })

  it('ignores a dangling trailing OR', () => {
    const result = parseSearch('a OR')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['a']])
  })

  it('ignores a leading OR', () => {
    const result = parseSearch('OR a')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['a']])
  })

  it('ignores a repeated OR', () => {
    const result = parseSearch('a OR OR b')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['a', 'b']])
  })

  it('runs an unterminated quote to the end of input', () => {
    const result = parseSearch('"x y')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['x y']])
  })

  it('has no groups for empty input', () => {
    const result = parseSearch('')
    if (!result.ok) throw new Error(result.error)
    expect(result.query.groups).toEqual([])
  })

  it('has no groups for whitespace-only input', () => {
    const result = parseSearch('   ')
    if (!result.ok) throw new Error(result.error)
    expect(result.query.groups).toEqual([])
  })

  it('rejects more than SEARCH_ATOMS_MAX atoms', () => {
    const words = Array.from({ length: SEARCH_ATOMS_MAX + 1 }, (_, i) => `w${i}`)
    const result = parseSearch(words.join(' '))
    expect(result.ok).toBe(false)
  })

  it('accepts exactly SEARCH_ATOMS_MAX atoms', () => {
    const words = Array.from({ length: SEARCH_ATOMS_MAX }, (_, i) => `w${i}`)
    const result = parseSearch(words.join(' '))
    expect(result.ok).toBe(true)
  })

  it('parses Japanese words', () => {
    const result = parseSearch('こんにちは 世界')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['こんにちは'], ['世界']])
  })

  it('ignores an empty label value', () => {
    const result = parseSearch('label: foo')
    if (!result.ok) throw new Error(result.error)
    expect(groupsOf(result.query)).toEqual([['foo']])
  })
})
