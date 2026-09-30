import { describe, expect, it } from 'vitest'
import { isOwnNoteOverlay, noteOverlayState } from './note-history'

describe('isOwnNoteOverlay', () => {
  it('accepts a marker from the same page load, with or without extra fields', () => {
    expect(isOwnNoteOverlay(noteOverlayState('d1'), 'd1')).toBe(true)
    expect(isOwnNoteOverlay({ ...noteOverlayState('d1'), other: 1 }, 'd1')).toBe(true)
  })

  it('rejects a marker from another page load', () => {
    expect(isOwnNoteOverlay(noteOverlayState('d1'), 'd2')).toBe(false)
    expect(isOwnNoteOverlay({ keptNoteOverlay: true }, 'd1')).toBe(false)
  })

  it('rejects anything else', () => {
    expect(isOwnNoteOverlay(null, 'd1')).toBe(false)
    expect(isOwnNoteOverlay(undefined, 'd1')).toBe(false)
    expect(isOwnNoteOverlay({}, 'd1')).toBe(false)
    expect(isOwnNoteOverlay({ keptNoteOverlay: 'true', doc: 'd1' }, 'd1')).toBe(false)
    expect(isOwnNoteOverlay('x', 'd1')).toBe(false)
  })
})
