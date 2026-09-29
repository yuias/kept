import type { ConcreteFormat, NoteFormat } from '../../shared/types'

export function nextFormat(current: ConcreteFormat): ConcreteFormat {
  return current === 'formatted' ? 'syntax' : 'formatted'
}

/** Format to PATCH on close, or null when the effective format would not change. */
export function formatToCommit(
  saved: NoteFormat,
  pending: ConcreteFormat | null,
  defaultFormat: ConcreteFormat,
): ConcreteFormat | null {
  if (pending === null) return null
  const current = saved === 'inherit' ? defaultFormat : saved
  return pending === current ? null : pending
}

/** Whether the toggle shows the "(default)" suffix: true iff nothing would be committed and the note is on inherit. */
export function showsDefault(saved: NoteFormat, pending: ConcreteFormat | null, defaultFormat: ConcreteFormat): boolean {
  return saved === 'inherit' && formatToCommit(saved, pending, defaultFormat) === null
}
