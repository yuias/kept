/** Distinct from folder reorder drags (text/plain), so drop targets can tell them apart. */
export const NOTE_DRAG_TYPE = 'application/x-kept-note'

export interface NoteDragPayload {
  id: string
  folderId: string | null
}

type DragData = Pick<DataTransfer, 'types' | 'getData' | 'setData'>

// Only the custom type is set: dropping a card on a text field inserts nothing.
export function writeNoteDrag(dt: Pick<DragData, 'setData'>, payload: NoteDragPayload): void {
  dt.setData(NOTE_DRAG_TYPE, JSON.stringify(payload))
}

/** Usable during dragover: browsers expose `types` then, but `getData` returns ''. */
export function isNoteDrag(dt: Pick<DataTransfer, 'types'>): boolean {
  return Array.from(dt.types).includes(NOTE_DRAG_TYPE)
}

/** Only meaningful in `drop`. Returns null for missing or malformed data. */
export function readNoteDrag(dt: Pick<DataTransfer, 'getData'>): NoteDragPayload | null {
  const raw = dt.getData(NOTE_DRAG_TYPE)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { id, folderId } = parsed as Record<string, unknown>
  if (typeof id !== 'string' || id === '') return null
  if (folderId !== null && typeof folderId !== 'string') return null
  return { id, folderId }
}
