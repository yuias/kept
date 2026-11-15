import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { verticalStepTarget } from './block-motion'

describe('verticalStepTarget', () => {
  const doc = '### a\n@[card](https://a.example)\n@[card](https://b.example)\n\n| x |\n|---|\n| 1 |\n\nend'

  function stateAt(line: number, readOnly = false): EditorState {
    const base = EditorState.create({ doc })
    return EditorState.create({
      doc,
      selection: { anchor: base.doc.line(line).to },
      extensions: EditorState.readOnly.of(readOnly),
    })
  }

  // The default vertical motion skipped the block widgets and landed on `line`.
  function step(state: EditorState, line: number, forward: boolean): number | null {
    return verticalStepTarget(state, state.selection.main, EditorSelection.cursor(state.doc.line(line).from), forward)
  }

  it('enters the adjacent line below instead of skipping a run of cards', () => {
    const state = stateAt(1)
    expect(step(state, 4, true)).toBe(state.doc.line(2).from)
  })

  it('enters the adjacent line above, such as the last row of a table', () => {
    const state = stateAt(8)
    expect(step(state, 4, false)).toBe(state.doc.line(7).from)
  })

  it('keeps the default when it reaches the adjacent line or stays on the line', () => {
    const state = stateAt(4)
    expect(step(state, 5, true)).toBeNull()
    expect(step(state, 4, false)).toBeNull()
  })

  it('keeps the default at the document edges', () => {
    expect(step(stateAt(1), 1, false)).toBeNull()
    expect(step(stateAt(9), 9, true)).toBeNull()
  })

  it('keeps the default in a read-only editor and for a non-empty selection', () => {
    expect(step(stateAt(1, true), 4, true)).toBeNull()
    const selected = stateAt(1).update({ selection: { anchor: 0, head: 3 } }).state
    expect(step(selected, 4, true)).toBeNull()
  })
})
