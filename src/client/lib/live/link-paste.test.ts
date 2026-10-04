import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport } from '@codemirror/language'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { cardMarkup } from '../../../shared/link-card'
import { cardChoice, detectUrlPaste, pendingField, type PendingCard, setPending } from './link-paste'

function stateFor(doc: string, anchor = 0, ...more: Extension[]): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [new LanguageSupport(markdownLanguage), pendingField, ...more],
  })
}

const URL_A = 'https://a.example'

describe('detectUrlPaste', () => {
  it('hits on an empty line', () => {
    expect(detectUrlPaste(stateFor('x\n\ny', 2), URL_A)).toEqual({ from: 2, to: 2, url: URL_A })
  })

  it('covers the whitespace of a whitespace-only line', () => {
    expect(detectUrlPaste(stateFor('x\n  \ny', 3), URL_A)).toEqual({ from: 2, to: 4, url: URL_A })
  })

  it('trims surrounding whitespace and newlines of the clipboard text', () => {
    expect(detectUrlPaste(stateFor(''), ` \n${URL_A}\n`)?.url).toBe(URL_A)
  })

  it('is null on a non-empty line', () => {
    expect(detectUrlPaste(stateFor('abc', 3), URL_A)).toBeNull()
  })

  it('is null with a non-empty selection', () => {
    const state = EditorState.create({
      doc: '  ',
      selection: { anchor: 0, head: 2 },
      extensions: [new LanguageSupport(markdownLanguage)],
    })
    expect(detectUrlPaste(state, URL_A)).toBeNull()
  })

  it('is null with multiple ranges', () => {
    const state = EditorState.create({
      doc: '\n',
      selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(1)]),
      extensions: [new LanguageSupport(markdownLanguage), EditorState.allowMultipleSelections.of(true)],
    })
    expect(detectUrlPaste(state, URL_A)).toBeNull()
  })

  it('is null when read-only', () => {
    const state = stateFor('', 0, EditorState.readOnly.of(true))
    expect(detectUrlPaste(state, URL_A)).toBeNull()
  })

  it.each([
    ['text around the url', 'text https://a.example text'],
    ['a markdown link', '[a](https://a.example)'],
    ['two urls on two lines', 'https://a.example\nhttps://b.example'],
    ['a non-http scheme', 'ftp://a.example'],
    ['a bare scheme', 'https://'],
  ])('is null for %s', (_name, text) => {
    expect(detectUrlPaste(stateFor(''), text)).toBeNull()
  })

  it('is null on an empty line inside a fenced code block', () => {
    const doc = '```\n\n```'
    expect(detectUrlPaste(stateFor(doc, 4), URL_A)).toBeNull()
  })
})

describe('cardChoice', () => {
  const markup = cardMarkup(URL_A)

  // The state after the URL was pasted onto the line starting at `from`.
  function afterPaste(doc: string, from: number): { state: EditorState; pending: PendingCard } {
    const pending = { from, to: from + URL_A.length, url: URL_A }
    return { state: stateFor(doc, pending.to), pending }
  }

  it('on the last line appends the card and a newline, caret at the end', () => {
    const { state, pending } = afterPaste(`intro\n${URL_A}`, 6)
    const next = state.update(cardChoice(state, pending)).state
    expect(next.doc.toString()).toBe(`intro\n${markup}\n`)
    expect(next.selection.main.head).toBe(next.doc.length)
    expect(next.selection.main.head).toBe(pending.from + markup.length + 1)
  })

  it('before an empty line adds no extra newline, caret at that line', () => {
    const { state, pending } = afterPaste(`${URL_A}\n\nrest`, 0)
    const next = state.update(cardChoice(state, pending)).state
    expect(next.doc.toString()).toBe(`${markup}\n\nrest`)
    expect(next.selection.main.head).toBe(pending.from + markup.length + 1)
    expect(next.doc.lineAt(next.selection.main.head).text).toBe('')
  })

  it('before a non-empty line inserts a newline, caret on the new empty line', () => {
    const { state, pending } = afterPaste(`${URL_A}\nrest`, 0)
    const next = state.update(cardChoice(state, pending)).state
    expect(next.doc.toString()).toBe(`${markup}\n\nrest`)
    expect(next.selection.main.head).toBe(pending.from + markup.length + 1)
    expect(next.doc.lineAt(next.selection.main.head).text).toBe('')
  })
})

describe('pendingField', () => {
  const pending: PendingCard = { from: 0, to: URL_A.length, url: URL_A }

  it('is set by the effect, even in a transaction that changes the doc', () => {
    const state = stateFor('')
    const next = state.update({
      changes: { from: 0, insert: URL_A },
      selection: { anchor: URL_A.length },
      effects: setPending.of(pending),
    }).state
    expect(next.field(pendingField)).toEqual(pending)
  })

  it('is cleared by a later doc change', () => {
    const set = stateFor(URL_A, URL_A.length).update({ effects: setPending.of(pending) }).state
    expect(set.update({ changes: { from: URL_A.length, insert: 'x' } }).state.field(pendingField)).toBeNull()
  })

  it('is cleared by a selection change', () => {
    const set = stateFor(URL_A, URL_A.length).update({ effects: setPending.of(pending) }).state
    expect(set.update({ selection: { anchor: 0 } }).state.field(pendingField)).toBeNull()
  })

  it('survives unrelated transactions', () => {
    const set = stateFor(URL_A, URL_A.length).update({ effects: setPending.of(pending) }).state
    expect(set.update({}).state.field(pendingField)).toEqual(pending)
  })
})
