import { describe, expect, it } from 'vitest'
import { linkClickAction } from './link-click'

const base = { readOnly: false, modifier: false, caretInLink: false, detail: 1, href: 'https://a.example' }

describe('linkClickAction', () => {
  it('opens a plain click when the caret is elsewhere', () => {
    expect(linkClickAction(base)).toBe('open')
  })

  it('only places the caret when it is already in the link', () => {
    expect(linkClickAction({ ...base, caretInLink: true })).toBe('caret')
  })

  it('opens in a read-only editor, even with the caret in the link', () => {
    expect(linkClickAction({ ...base, readOnly: true, caretInLink: true })).toBe('open')
  })

  it('opens with a modifier or the middle button, even with the caret in the link', () => {
    expect(linkClickAction({ ...base, modifier: true, caretInLink: true })).toBe('open')
  })

  it('does nothing on the second click of a double-click', () => {
    expect(linkClickAction({ ...base, detail: 2 })).toBe('none')
    expect(linkClickAction({ ...base, detail: 2, modifier: true })).toBe('none')
    expect(linkClickAction({ ...base, detail: 2, readOnly: true })).toBe('none')
  })

  it('never opens a disallowed target', () => {
    expect(linkClickAction({ ...base, href: null })).toBe('none')
    expect(linkClickAction({ ...base, href: null, readOnly: true, modifier: true })).toBe('none')
  })
})
