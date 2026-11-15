import { describe, expect, it } from 'vitest'
import { type CloseState, shouldDiscardOnClose } from './empty-note'

const discardable: CloseState = {
  initialId: 'new',
  noteId: 'n1',
  trashed: false,
  flushed: true,
  title: '',
  body: '',
}

describe('shouldDiscardOnClose', () => {
  it('discards a created, untrashed, flushed, blank new note', () => {
    expect(shouldDiscardOnClose(discardable)).toBe(true)
  })

  it('treats whitespace-only title and body as blank', () => {
    expect(shouldDiscardOnClose({ ...discardable, title: ' \t', body: '\n  \n' })).toBe(true)
  })

  it('keeps an existing note that was emptied', () => {
    expect(shouldDiscardOnClose({ ...discardable, initialId: 'n1' })).toBe(false)
  })

  it('keeps a note that was never created', () => {
    expect(shouldDiscardOnClose({ ...discardable, noteId: null })).toBe(false)
  })

  it('keeps a trashed note', () => {
    expect(shouldDiscardOnClose({ ...discardable, trashed: true })).toBe(false)
  })

  it('keeps the note when the final flush failed', () => {
    expect(shouldDiscardOnClose({ ...discardable, flushed: false })).toBe(false)
  })

  it('keeps a note with a title', () => {
    expect(shouldDiscardOnClose({ ...discardable, title: 'Groceries' })).toBe(false)
  })

  it('keeps a note with a body', () => {
    expect(shouldDiscardOnClose({ ...discardable, body: 'a' })).toBe(false)
  })
})
