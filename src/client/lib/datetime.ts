/** `YYYY-MM-DD` of `ms` in `timeZone` (default: the runtime's zone). */
function calendarDay(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms)
}

/**
 * Google Keep style: time only for today, month + day within the same year,
 * full date otherwise. "Today" is the calendar day in `timeZone` (default: the
 * runtime's zone).
 */
export function editedFormatOptions(ms: number, now: number, timeZone?: string): Intl.DateTimeFormatOptions {
  const zone = timeZone ? { timeZone } : {}
  const day = calendarDay(ms, timeZone)
  const today = calendarDay(now, timeZone)
  // A timestamp slightly ahead of `now` (clock skew) is still today's.
  if (day === today) return { hour: 'numeric', minute: '2-digit', ...zone }
  if (day.slice(0, 4) === today.slice(0, 4)) return { month: 'short', day: 'numeric', ...zone }
  return { year: 'numeric', month: 'short', day: 'numeric', ...zone }
}

export function formatEdited(ms: number, locale: string, now: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, editedFormatOptions(ms, now, timeZone)).format(ms)
}

/** Full timestamp for tooltips. */
export function formatFullTimestamp(ms: number, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(ms)
}
