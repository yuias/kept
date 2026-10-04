import { type EditorState } from '@codemirror/state'

/** 1-based numbers of every line touched by a selection range. */
export function activeLineNumbers(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}
