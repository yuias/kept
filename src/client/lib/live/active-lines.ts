import { type EditorState } from '@codemirror/state'

/**
 * 1-based numbers of every line touched by a selection range. A read-only
 * editor has none: its source cannot be edited, so revealing it only shows
 * markup (the initial selection would otherwise unrender the first line).
 */
export function activeLineNumbers(state: EditorState): Set<number> {
  const lines = new Set<number>()
  if (state.readOnly) return lines
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

/**
 * True when a selection range touches or overlaps [from, to], edges included,
 * so a cursor directly before or after an element still reveals its markers.
 * Always false in a read-only editor, for the same reason as activeLineNumbers.
 */
export function touchesSelection(state: EditorState, from: number, to: number): boolean {
  if (state.readOnly) return false
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from)
}
