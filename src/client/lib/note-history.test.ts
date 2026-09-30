import { describe, expect, it } from 'vitest'
import { isNoteOverlayState, NOTE_OVERLAY_STATE } from './note-history'

describe('isNoteOverlayState', () => {
  it('accepts the marker and objects that carry it', () => {
    expect(isNoteOverlayState(NOTE_OVERLAY_STATE)).toBe(true)
    expect(isNoteOverlayState({ keptNoteOverlay: true, other: 1 })).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isNoteOverlayState(null)).toBe(false)
    expect(isNoteOverlayState(undefined)).toBe(false)
    expect(isNoteOverlayState({})).toBe(false)
    expect(isNoteOverlayState({ keptNoteOverlay: 'true' })).toBe(false)
    expect(isNoteOverlayState('x')).toBe(false)
  })
})
