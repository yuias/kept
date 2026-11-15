import { EditorSelection, type EditorState, type Extension, Prec, type SelectionRange } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'

/**
 * Where a vertical cursor move from `range` should land instead of `target`
 * (the default move), or null to keep the default. CodeMirror's vertical
 * motion steps over block widgets, so a line rendered as a card or table
 * could otherwise only be entered with the mouse. Entering the adjacent line
 * reveals its source.
 */
export function verticalStepTarget(
  state: EditorState,
  range: SelectionRange,
  target: SelectionRange,
  forward: boolean,
): number | null {
  // Block widgets never reveal their source in a read-only editor.
  if (state.readOnly || !range.empty) return null
  const current = state.doc.lineAt(range.head).number
  const adjacent = current + (forward ? 1 : -1)
  if (adjacent < 1 || adjacent > state.doc.lines) return null
  // Staying on the line (a wrapped line) or reaching the adjacent one means nothing was skipped.
  const landed = state.doc.lineAt(target.head).number
  if (landed === current || landed === adjacent) return null
  return state.doc.line(adjacent).from
}

// Multiple cursors keep the default motion.
function stepVertically(forward: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view
    if (state.selection.ranges.length !== 1) return false
    const range = state.selection.main
    const step = verticalStepTarget(state, range, view.moveVertically(range, forward), forward)
    if (step === null) return false
    view.dispatch({ selection: EditorSelection.cursor(step), scrollIntoView: true, userEvent: 'select' })
    return true
  }
}

// Above defaultKeymap, which the editor lists before this extension.
export const blockMotion: Extension = Prec.high(
  keymap.of([
    { key: 'ArrowDown', run: stepVertically(true) },
    { key: 'ArrowUp', run: stepVertically(false) },
  ]),
)
