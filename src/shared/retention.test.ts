import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './types'
import { isTrashRetentionDays, trashCutoff } from './retention'

describe('isTrashRetentionDays', () => {
  it.each([null, 1, 30, 3650])('accepts %s', (value) => {
    expect(isTrashRetentionDays(value)).toBe(true)
  })

  it.each([0, -1, 1.5, 3651, '30', undefined, NaN, Infinity])('rejects %s', (value) => {
    expect(isTrashRetentionDays(value)).toBe(false)
  })
})

describe('trashCutoff', () => {
  it('subtracts whole days from now', () => {
    const now = 1_700_000_000_000
    expect(trashCutoff(now, 30)).toBe(now - 30 * 86_400_000)
  })
})

describe('DEFAULT_SETTINGS', () => {
  it('keeps trashed notes for 30 days', () => {
    expect(DEFAULT_SETTINGS.trashRetentionDays).toBe(30)
  })
})
