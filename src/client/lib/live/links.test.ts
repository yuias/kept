import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { linkClickAction } from './links'

describe('linkClickAction', () => {
  const doc = '[a](https://a.example)\n\nsecond'
  const stateAt = (anchor: number, readOnly = false): EditorState =>
    EditorState.create({
      doc,
      selection: { anchor },
      extensions: [new LanguageSupport(markdownLanguage), EditorState.readOnly.of(readOnly)],
    })

  it('opens a link on a line without the caret', () => {
    expect(linkClickAction(stateAt(doc.length), 1)).toBe('open')
  })

  it('only places the caret on the caret line', () => {
    expect(linkClickAction(stateAt(2), 1)).toBe('caret')
  })

  it('opens on the caret line when the editor is read-only', () => {
    expect(linkClickAction(stateAt(2, true), 1)).toBe('open')
  })
})
