import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport } from '@codemirror/language'
import { Compartment, EditorState, RangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { liveTables, tableField } from './tables'

const doc = 'top\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nbottom'
const headerFrom = doc.indexOf('| a')
const delimiterFrom = doc.indexOf('|---')
const lastRowFrom = doc.indexOf('| 1')
const tableTo = lastRowFrom + '| 1 | 2 |'.length

function tableState(text: string, anchor = 0, head = anchor): EditorState {
  return EditorState.create({
    doc: text,
    selection: { anchor, head },
    extensions: [new LanguageSupport(markdownLanguage), liveTables],
  })
}

interface Found {
  from: number
  to: number
  block: boolean
  readOnly: boolean
}

function ranges(state: EditorState): Found[] {
  const found: Found[] = []
  for (const iter = RangeSet.iter([state.field(tableField).decorations]); iter.value; iter.next()) {
    const widget = iter.value.spec.widget as { readOnly: boolean }
    found.push({ from: iter.from, to: iter.to, block: iter.value.spec.block === true, readOnly: widget.readOnly })
  }
  return found
}

describe('tableField', () => {
  it('replaces an untouched table with one block widget spanning its lines', () => {
    expect(ranges(tableState(doc))).toEqual([{ from: headerFrom, to: tableTo, block: true, readOnly: false }])
  })

  it('shows no widget while the caret is on any table line', () => {
    expect(ranges(tableState(doc, headerFrom + 2))).toEqual([])
    expect(ranges(tableState(doc, delimiterFrom + 1))).toEqual([])
    expect(ranges(tableState(doc, tableTo))).toEqual([])
  })

  it('shows no widget for a selection that ends inside the table', () => {
    expect(ranges(tableState(doc, 0, headerFrom + 2))).toEqual([])
  })

  it('keeps the table list when only the selection moves', () => {
    const before = tableState(doc)
    const inside = before.update({ selection: { anchor: headerFrom + 2 } }).state
    expect(inside.field(tableField).tables).toBe(before.field(tableField).tables)
    expect(ranges(inside)).toEqual([])
    expect(ranges(inside.update({ selection: { anchor: 0 } }).state)).toHaveLength(1)
  })

  it('adds a widget when an edit completes a table', () => {
    const text = 'top\n\n| a | b |\n| 1 | 2 |\n\nbottom'
    const before = tableState(text)
    expect(ranges(before)).toEqual([])
    const at = text.indexOf('| 1')
    const after = before.update({ changes: { from: at, insert: '|---|---|\n' } }).state
    expect(after.field(tableField).tables).toHaveLength(1)
    expect(ranges(after)).toHaveLength(1)
  })

  it('follows the read-only state', () => {
    const mode = new Compartment()
    const state = EditorState.create({
      doc,
      extensions: [new LanguageSupport(markdownLanguage), liveTables, mode.of([])],
    })
    expect(ranges(state)[0]?.readOnly).toBe(false)
    const locked = state.update({ effects: mode.reconfigure(EditorState.readOnly.of(true)) }).state
    expect(ranges(locked)[0]?.readOnly).toBe(true)
    const unlocked = locked.update({ effects: mode.reconfigure([]) }).state
    expect(ranges(unlocked)[0]?.readOnly).toBe(false)
  })

  it('draws a table at the end of the document without a trailing newline', () => {
    expect(ranges(tableState('z\n\n| a | b |\n|---|---|', 0))).toEqual([{ from: 3, to: 22, block: true, readOnly: false }])
  })

  it('leaves a table inside a blockquote as source', () => {
    expect(ranges(tableState('top\n\n> | a | b |\n> |---|---|\n> | 1 | 2 |\n\nbottom'))).toEqual([])
  })
})
