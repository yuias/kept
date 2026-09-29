import { describe, expect, it } from 'vitest'
import { editedFormatOptions, formatEdited, formatFullTimestamp } from './datetime'

const TZ = 'UTC'
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)

describe('editedFormatOptions', () => {
  it('shows only the time on the same UTC day', () => {
    const options = editedFormatOptions(Date.UTC(2026, 5, 15, 8, 30), NOW, TZ)
    expect(options).toMatchObject({ hour: 'numeric', minute: '2-digit' })
    expect(options).not.toHaveProperty('month')
  })

  it('shows month and day for an earlier day in the same year', () => {
    const options = editedFormatOptions(Date.UTC(2026, 1, 3, 8, 30), NOW, TZ)
    expect(options).toMatchObject({ month: 'short', day: 'numeric' })
    expect(options).not.toHaveProperty('year')
    expect(options).not.toHaveProperty('hour')
  })

  it('shows the full date for a previous year', () => {
    const options = editedFormatOptions(Date.UTC(2025, 11, 31, 23, 0), NOW, TZ)
    expect(options).toMatchObject({ year: 'numeric', month: 'short', day: 'numeric' })
    expect(options).not.toHaveProperty('hour')
  })

  it('treats the calendar-day boundary as not today', () => {
    const now = Date.UTC(2026, 5, 16, 0, 1)
    expect(editedFormatOptions(Date.UTC(2026, 5, 15, 23, 59), now, TZ)).not.toHaveProperty('hour')
    expect(editedFormatOptions(Date.UTC(2026, 5, 16, 0, 0), now, TZ)).toHaveProperty('hour')
  })

  it('uses the today branch for a slightly future timestamp on the same day', () => {
    expect(editedFormatOptions(NOW + 5 * 60_000, NOW, TZ)).toMatchObject({ hour: 'numeric', minute: '2-digit' })
  })

  it('applies the time zone to the day comparison', () => {
    const ms = Date.UTC(2026, 5, 15, 23, 30)
    expect(editedFormatOptions(ms, Date.UTC(2026, 5, 16, 1, 0), TZ)).not.toHaveProperty('hour')
    expect(editedFormatOptions(ms, Date.UTC(2026, 5, 16, 1, 0), 'Asia/Tokyo')).toHaveProperty('hour')
  })
})

describe('formatEdited', () => {
  const samples = [Date.UTC(2026, 5, 15, 8, 30), Date.UTC(2026, 1, 3, 8, 30), Date.UTC(2025, 11, 31, 23, 0)]

  it.each(['en', 'ja'])('matches Intl output for %s', (locale) => {
    for (const ms of samples) {
      expect(formatEdited(ms, locale, NOW, TZ)).toBe(
        new Intl.DateTimeFormat(locale, editedFormatOptions(ms, NOW, TZ)).format(ms),
      )
    }
  })
})

describe('formatFullTimestamp', () => {
  it('uses medium date and short time', () => {
    const ms = Date.UTC(2026, 5, 15, 8, 30)
    expect(formatFullTimestamp(ms, 'en', TZ)).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(ms),
    )
  })
})
