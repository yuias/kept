import { describe, expect, it } from 'vitest'
import { isNoteDrag, NOTE_DRAG_TYPE, readNoteDrag, writeNoteDrag } from './note-drag'

function fakeDataTransfer(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    get types(): string[] {
      return [...store.keys()]
    },
    getData: (type: string): string => store.get(type) ?? '',
    setData: (type: string, value: string): void => {
      store.set(type, value)
    },
  }
}

describe('writeNoteDrag / readNoteDrag', () => {
  it('round-trips a root note', () => {
    const dt = fakeDataTransfer()
    writeNoteDrag(dt, { id: 'n1', folderId: null })
    expect(readNoteDrag(dt)).toEqual({ id: 'n1', folderId: null })
  })

  it('round-trips a note in a folder', () => {
    const dt = fakeDataTransfer()
    writeNoteDrag(dt, { id: 'n2', folderId: 'f1' })
    expect(readNoteDrag(dt)).toEqual({ id: 'n2', folderId: 'f1' })
  })

  it('does not set text/plain', () => {
    const dt = fakeDataTransfer()
    writeNoteDrag(dt, { id: 'n1', folderId: null })
    expect(dt.types).toEqual([NOTE_DRAG_TYPE])
    expect(dt.getData('text/plain')).toBe('')
  })

  it.each([
    ['empty data', ''],
    ['invalid JSON', '{not json'],
    ['a non-object', '"x"'],
    ['null', 'null'],
    ['an empty object', '{}'],
    ['an empty id', JSON.stringify({ id: '', folderId: null })],
    ['a non-string folderId', JSON.stringify({ id: 'a', folderId: 3 })],
    ['a missing folderId', JSON.stringify({ id: 'a' })],
  ])('returns null for %s', (_name, raw) => {
    expect(readNoteDrag(fakeDataTransfer(raw ? { [NOTE_DRAG_TYPE]: raw } : {}))).toBeNull()
  })
})

describe('isNoteDrag', () => {
  it('is true when the note type is present', () => {
    expect(isNoteDrag({ types: ['text/plain', NOTE_DRAG_TYPE] })).toBe(true)
  })

  it('is false for a folder reorder drag', () => {
    expect(isNoteDrag({ types: ['text/plain'] })).toBe(false)
  })
})
