import type { AppSettings, ConcreteFormat, NoteFormat } from './types'

const NOTE_FORMATS: readonly NoteFormat[] = ['inherit', 'formatted', 'syntax']
const CONCRETE_FORMATS: readonly ConcreteFormat[] = ['formatted', 'syntax']

export function isNoteFormat(value: unknown): value is NoteFormat {
  return typeof value === 'string' && (NOTE_FORMATS as readonly string[]).includes(value)
}

export function isConcreteFormat(value: unknown): value is ConcreteFormat {
  return typeof value === 'string' && (CONCRETE_FORMATS as readonly string[]).includes(value)
}

// Once a note leaves 'inherit' it can never go back, so the default format
// can still change later without silently changing already-fixed notes.
export function canChangeFormat(from: NoteFormat, to: NoteFormat): boolean {
  return !(from !== 'inherit' && to === 'inherit')
}

export function effectiveFormat(format: NoteFormat, settings: AppSettings): ConcreteFormat {
  return format === 'inherit' ? settings.defaultFormat : format
}
