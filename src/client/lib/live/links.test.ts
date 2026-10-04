import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { linkClickAction, linkHref } from './links'

describe('linkHref', () => {
  it.each([
    ['https://a.example/x', 'https://a.example/x'],
    ['HTTP://A.EXAMPLE', 'HTTP://A.EXAMPLE'],
    ['mailto:a@b.example', 'mailto:a@b.example'],
    ['<https://a.example>', 'https://a.example'],
    ['www.example.com', 'http://www.example.com'],
    ['a@b.example', 'mailto:a@b.example'],
  ])('allows %j', (raw, href) => {
    expect(linkHref(raw)).toBe(href)
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://a.example', '/relative', '#frag', ''])(
    'rejects %j',
    (raw) => {
      expect(linkHref(raw)).toBeNull()
    },
  )
})

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
