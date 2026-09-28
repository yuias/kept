import { describe, expect, it } from 'vitest'
import { LABEL_MAX_CHARS, LABELS_PER_NOTE_MAX } from './limits'
import { normalizeLabels, parseLabelInput, sortLabelsCaseInsensitive } from './labels'

describe('parseLabelInput + normalizeLabels', () => {
  it('splits on commas, trims, collapses whitespace, drops empties, and dedupes case-insensitively', () => {
    const result = normalizeLabels(parseLabelInput('a, A ,b,,'))
    expect(result).toEqual({ ok: true, labels: ['a', 'b'] })
  })

  it('collapses inner whitespace within a label', () => {
    const result = normalizeLabels(parseLabelInput('work  idea, foo   bar'))
    expect(result).toEqual({ ok: true, labels: ['work idea', 'foo bar'] })
  })

  it('keeps the first spelling seen for a case-insensitive duplicate', () => {
    const result = normalizeLabels(['Work', 'work', 'WORK'])
    expect(result).toEqual({ ok: true, labels: ['Work'] })
  })
})

describe('normalizeLabels errors', () => {
  it('rejects a label longer than LABEL_MAX_CHARS', () => {
    const result = normalizeLabels(['a'.repeat(LABEL_MAX_CHARS + 1)])
    expect(result.ok).toBe(false)
  })

  it('accepts a label exactly at LABEL_MAX_CHARS', () => {
    const result = normalizeLabels(['a'.repeat(LABEL_MAX_CHARS)])
    expect(result.ok).toBe(true)
  })

  it('rejects more than LABELS_PER_NOTE_MAX distinct labels', () => {
    const labels = Array.from({ length: LABELS_PER_NOTE_MAX + 1 }, (_, i) => `label${i}`)
    const result = normalizeLabels(labels)
    expect(result.ok).toBe(false)
  })

  it('accepts exactly LABELS_PER_NOTE_MAX distinct labels', () => {
    const labels = Array.from({ length: LABELS_PER_NOTE_MAX }, (_, i) => `label${i}`)
    const result = normalizeLabels(labels)
    expect(result.ok).toBe(true)
  })

  it('rejects a label that still contains a comma (bypassing parseLabelInput)', () => {
    const result = normalizeLabels(['a,b'])
    expect(result.ok).toBe(false)
  })
})

describe('sortLabelsCaseInsensitive', () => {
  it('sorts case-insensitively', () => {
    expect(sortLabelsCaseInsensitive(['banana', 'Apple', 'cherry'])).toEqual(['Apple', 'banana', 'cherry'])
  })

  it('sorts by code unit after an ASCII-only fold, matching SQLite COLLATE NOCASE (non-ASCII "é" sorts after "z")', () => {
    expect(sortLabelsCaseInsensitive(['é', 'z'])).toEqual(['z', 'é'])
  })
})
