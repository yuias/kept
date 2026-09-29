import { describe, expect, it } from 'vitest'
import { REGEX_SOURCE_MAX_CHARS, SEARCH_ATOMS_MAX } from './limits'
import { parseSearch, type SearchAtom, type SearchQuery } from './search'

function atomLabel(atom: SearchAtom): string {
  switch (atom.kind) {
    case 'text':
      return atom.value
    case 'label':
      return `label:${atom.value}`
    case 'regex':
      return `/${atom.source}/${atom.flags}`
  }
}

function groupsOf(query: SearchQuery): unknown[][] {
  return query.groups.map((group) => group.map((atom) => atomLabel(atom)))
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

  describe('regex atoms', () => {
    function parseOk(input: string): SearchQuery {
      const result = parseSearch(input)
      if (!result.ok) throw new Error(result.error)
      return result.query
    }

    it('parses /foo bar/i as one atom, spaces included', () => {
      expect(parseOk('/foo bar/i').groups).toEqual([[{ kind: 'regex', source: 'foo bar', flags: 'i' }]])
    })

    it('keeps an escaped slash inside the pattern', () => {
      expect(parseOk('/a\\/b/').groups).toEqual([[{ kind: 'regex', source: 'a\\/b', flags: '' }]])
    })

    it('does not treat an escaped backslash before the slash as an escape', () => {
      expect(parseOk('/a\\\\/').groups).toEqual([[{ kind: 'regex', source: 'a\\\\', flags: '' }]])
    })

    it('accepts every allowed flag', () => {
      expect(parseOk('/x/imsu').groups).toEqual([[{ kind: 'regex', source: 'x', flags: 'imsu' }]])
    })

    it('combines a regex with other atoms and OR', () => {
      expect(groupsOf(parseOk('/foo/ OR bar label:x'))).toEqual([['/foo/', 'bar'], ['label:x']])
    })

    it('keeps a regex followed by more words separate', () => {
      expect(groupsOf(parseOk('/a b/i c'))).toEqual([['/a b/i'], ['c']])
    })

    it('parses two adjacent regexes as two atoms', () => {
      expect(parseOk('/a/ /b/').groups).toEqual([
        [{ kind: 'regex', source: 'a', flags: '' }],
        [{ kind: 'regex', source: 'b', flags: '' }],
      ])
    })

    it('parses a regex followed by a slash-containing word as regex + text', () => {
      expect(parseOk('/foo/ path/to').groups).toEqual([
        [{ kind: 'regex', source: 'foo', flags: '' }],
        [{ kind: 'text', value: 'path/to' }],
      ])
    })

    it('reports /usr/local/bin as a bad-flag error', () => {
      expect(parseSearch('/usr/local/bin').ok).toBe(false)
    })

    it('rejects a flag outside imsu', () => {
      expect(parseSearch('/x/g').ok).toBe(false)
    })

    it('rejects a duplicated flag', () => {
      expect(parseSearch('/x/ii').ok).toBe(false)
    })

    it('rejects a nested quantifier as too slow', () => {
      const result = parseSearch('/(a+)+/')
      expect(result).toEqual({ ok: false, error: 'pattern may be too slow' })
    })

    it('rejects an invalid pattern', () => {
      expect(parseSearch('/(/').ok).toBe(false)
      expect(parseSearch('/[/').ok).toBe(false)
    })

    it('rejects an empty pattern', () => {
      expect(parseSearch('//').ok).toBe(false)
    })

    it('rejects a pattern over REGEX_SOURCE_MAX_CHARS', () => {
      expect(parseSearch(`/${'a'.repeat(REGEX_SOURCE_MAX_CHARS + 1)}/`).ok).toBe(false)
      expect(parseSearch(`/${'a'.repeat(REGEX_SOURCE_MAX_CHARS)}/`).ok).toBe(true)
    })

    it('counts a regex toward SEARCH_ATOMS_MAX', () => {
      const words = Array.from({ length: SEARCH_ATOMS_MAX }, (_, i) => `w${i}`)
      expect(parseSearch(`${words.join(' ')} /x/`).ok).toBe(false)
    })

    it('leaves path/to as a text atom', () => {
      expect(parseOk('path/to').groups).toEqual([[{ kind: 'text', value: 'path/to' }]])
    })

    it('leaves an unterminated /foo as a text atom', () => {
      expect(parseOk('/foo').groups).toEqual([[{ kind: 'text', value: '/foo' }]])
    })

    it('does not start a regex in the middle of a word', () => {
      expect(parseOk('a/b/i').groups).toEqual([[{ kind: 'text', value: 'a/b/i' }]])
    })
  })
})
