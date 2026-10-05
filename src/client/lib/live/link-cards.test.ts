import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport } from '@codemirror/language'
import { EditorState, RangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { cardField, collectCardLines, isInCode, linkCards } from './link-cards'

function stateFor(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [new LanguageSupport(markdownLanguage)] })
}

describe('collectCardLines', () => {
  it('finds card lines with their range and url', () => {
    const doc = 'intro\n@[card](https://a.example/x)\n\ntext\n@[card](https://b.example/y_(z))  \nend'
    const first = doc.indexOf('@[card](https://a')
    const second = doc.indexOf('@[card](https://b')
    expect(collectCardLines(stateFor(doc))).toEqual([
      { from: first, to: first + '@[card](https://a.example/x)'.length, url: 'https://a.example/x' },
      { from: second, to: second + '@[card](https://b.example/y_(z))  '.length, url: 'https://b.example/y_(z)' },
    ])
  })

  it('ignores a card inside a closed fenced block', () => {
    const doc = '```\n@[card](https://a.example)\n```\n@[card](https://b.example)'
    expect(collectCardLines(stateFor(doc)).map((c) => c.url)).toEqual(['https://b.example'])
  })

  it('ignores a card inside an unclosed fenced block', () => {
    expect(collectCardLines(stateFor('```\n@[card](https://a.example)'))).toEqual([])
  })

  it('ignores a card inside an indented code block', () => {
    expect(collectCardLines(stateFor('para\n\n    @[card](https://a.example)\n'))).toEqual([])
  })

  it('ignores mid-line, indented and non-http card text', () => {
    const doc = 'see @[card](https://a.example)\n @[card](https://b.example)\n@[card](ftp://c.example)'
    expect(collectCardLines(stateFor(doc))).toEqual([])
  })
})

describe('collectCardLines and tables', () => {
  it('ignores a card line that GFM takes as a table row', () => {
    const doc = '| a | b |\n|---|---|\n@[card](https://a.example)\n\n@[card](https://b.example)'
    expect(collectCardLines(stateFor(doc)).map((c) => c.url)).toEqual(['https://b.example'])
  })

  it('keeps a card line separated from the table by a blank line', () => {
    const doc = '| a | b |\n|---|---|\n\n@[card](https://a.example)'
    expect(collectCardLines(stateFor(doc)).map((c) => c.url)).toEqual(['https://a.example'])
  })
})

describe('isInCode', () => {
  it('is true inside fenced code and inline code', () => {
    const doc = '```\nabc\n```\n\nuse `code` here'
    const state = stateFor(doc)
    expect(isInCode(state, doc.indexOf('abc') + 1)).toBe(true)
    expect(isInCode(state, doc.indexOf('code') + 1)).toBe(true)
  })

  it('is false in a paragraph and on an empty line after a closed fence', () => {
    const doc = '```\nabc\n```\n\nplain text'
    const state = stateFor(doc)
    expect(isInCode(state, doc.indexOf('plain') + 2)).toBe(false)
    expect(isInCode(state, doc.indexOf('\n\n') + 1)).toBe(false)
  })
})

describe('cardField', () => {
  function cardState(doc: string, anchor = 0): EditorState {
    return EditorState.create({
      doc,
      selection: { anchor },
      extensions: [new LanguageSupport(markdownLanguage), linkCards],
    })
  }

  function blockRanges(state: EditorState): { from: number; to: number; block: boolean }[] {
    const ranges: { from: number; to: number; block: boolean }[] = []
    for (const iter = RangeSet.iter([state.field(cardField).decorations]); iter.value; iter.next()) {
      ranges.push({ from: iter.from, to: iter.to, block: iter.value.spec.block === true })
    }
    return ranges
  }

  const doc = 'top\n@[card](https://a.example)\nbottom'
  const cardFrom = doc.indexOf('@[card]')
  const cardTo = cardFrom + '@[card](https://a.example)'.length

  it('replaces a card line off the caret line with one block widget', () => {
    expect(blockRanges(cardState(doc))).toEqual([{ from: cardFrom, to: cardTo, block: true }])
  })

  it('shows no widget while the caret is on the card line', () => {
    expect(blockRanges(cardState(doc, cardFrom + 3))).toEqual([])
    expect(blockRanges(cardState(doc, cardTo))).toEqual([])
  })

  it('keeps the card list when only the selection moves', () => {
    const before = cardState(doc)
    const after = before.update({ selection: { anchor: cardFrom + 2 } }).state
    expect(after.field(cardField).cards).toBe(before.field(cardField).cards)
    expect(blockRanges(after)).toEqual([])
    expect(blockRanges(after.update({ selection: { anchor: 0 } }).state)).toHaveLength(1)
  })

  it('adds a widget when an edit creates a card line', () => {
    const before = cardState('a\n\nb')
    expect(blockRanges(before)).toEqual([])
    const after = before.update({ changes: { from: 2, insert: '@[card](https://b.example)' } }).state
    expect(after.field(cardField).cards.map((c) => c.url)).toEqual(['https://b.example'])
    expect(blockRanges(after)).toEqual([{ from: 2, to: 2 + '@[card](https://b.example)'.length, block: true }])
  })
})
