import { getExtensionDependencyFromEditor } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { $isTableCellNode, $isTableNode, $isTableRowNode, type TableNode, type TableRowNode } from '@lexical/table'
import { $getRoot, $getSelection, $setSelection, UNDO_COMMAND } from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorCore, type EditorCore } from './core'
import { $exportMarkdown, $rootSeams, roundTrip, TRANSFORMERS } from './markdown'
import { deleteColumn, deleteRow, insertColumnRight, insertRowBelow } from './tables'

const open: EditorCore[] = []
afterEach(() => {
  for (const core of open.splice(0)) core.destroy()
  vi.useRealTimers()
})

function create(value: string) {
  const onChange = vi.fn<(markdown: string) => void>()
  const core = createEditorCore({
    value,
    readOnly: false,
    tasksToggleable: false,
    onChange,
    onPaste: () => {},
    onUnsupported: () => {},
    onEmptyChange: () => {},
  })
  open.push(core)
  // History is off without a window; the clock lets each step count as its own undo step.
  const history = getExtensionDependencyFromEditor(core.editor, HistoryExtension).output
  history.now.value = () => 0
  history.disabled.value = false
  core.editor.update(() => $getRoot().select(0, 0), { discrete: true })
  return { core, onChange }
}

const exported = (core: EditorCore): string => core.editor.read(() => $exportMarkdown(TRANSFORMERS, $rootSeams()))

const $table = (): TableNode => $getRoot().getChildren().filter($isTableNode)[0]!
const $row = (index: number): TableRowNode => $table().getChildren().filter($isTableRowNode)[index]!

/** Puts the caret in the cell at (`row`, `column`) of the first table. */
function caretIn(core: EditorCore, row: number, column: number): void {
  core.editor.update(
    () => {
      $row(row).getChildren().filter($isTableCellNode)[column]!.selectStart()
    },
    { discrete: true },
  )
}

/** Rows and columns as the export shows them: the delimiter line is not a row. */
function size(markdown: string): { rows: number; columns: number } {
  const lines = markdown.split('\n').filter((line) => line.startsWith('|'))
  return { rows: lines.length - 1, columns: lines[0]!.split(/(?<!\\)\|/).length - 2 }
}

const WITH_HEADER = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'
// An empty header row is how a table without one is stored; every row in the editor is a body row.
const HEADERLESS = '| | |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'

describe('table operations', () => {
  it('changes the row or column count by one, in one change and one undo step', () => {
    const operations = [
      [insertRowBelow, { rows: 3, columns: 2 }],
      [insertColumnRight, { rows: 2, columns: 3 }],
      [deleteRow, { rows: 1, columns: 2 }],
      [deleteColumn, { rows: 2, columns: 1 }],
    ] as const
    for (const [operation, expected] of operations) {
      const { core, onChange } = create('| a | b |\n| --- | --- |\n| 1 | 2 |')
      caretIn(core, 1, 0)
      onChange.mockClear()
      expect(operation(core.editor, core.gate)).toBe(true)
      expect(size(exported(core))).toEqual(expected)
      expect(onChange).toHaveBeenCalledTimes(1)
      core.editor.dispatchCommand(UNDO_COMMAND, undefined)
      expect(exported(core)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
    }
  })

  it('puts the new row below the caret as a body row, also under the header', () => {
    const { core } = create(WITH_HEADER)
    caretIn(core, 0, 0)
    insertRowBelow(core.editor, core.gate)
    expect(exported(core)).toBe('| a | b |\n| --- | --- |\n|  |  |\n| 1 | 2 |\n| 3 | 4 |')
  })

  it('puts the new column right of the caret, with header cells in the header row', () => {
    const { core } = create(WITH_HEADER)
    caretIn(core, 1, 0)
    insertColumnRight(core.editor, core.gate)
    expect(exported(core)).toBe('| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |\n| 3 |  | 4 |')
  })

  it('keeps the header row when the only body row is deleted, and the export round-trips', () => {
    const { core } = create('| a | b |\n| --- | --- |\n| 1 | 2 |')
    caretIn(core, 1, 1)
    expect(deleteRow(core.editor, core.gate)).toBe(true)
    const markdown = exported(core)
    expect(markdown).toBe('| a | b |\n| --- | --- |')
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('removes the table with its last row, and the caret stays usable', () => {
    const { core } = create('| a |\n| --- |')
    caretIn(core, 0, 0)
    expect(deleteRow(core.editor, core.gate)).toBe(true)
    expect(exported(core)).toBe('')
    expect(core.editor.read(() => $getRoot().getChildren().map((node) => node.getType()))).toEqual(['paragraph'])
    expect(core.editor.read(() => $getSelection()?.getNodes().map((node) => node.getType()))).toEqual(['paragraph'])
  })

  it('removes the table with its last column', () => {
    const { core } = create('| a |\n| --- |\n| 1 |')
    caretIn(core, 0, 0)
    expect(deleteColumn(core.editor, core.gate)).toBe(true)
    expect(exported(core)).toBe('')
  })

  it('returns false and changes nothing with the caret outside a table', () => {
    const { core, onChange } = create('intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |')
    core.editor.update(() => $getRoot().getFirstChildOrThrow().selectStart(), { discrete: true })
    const before = exported(core)
    const state = core.editor.getEditorState()
    onChange.mockClear()
    for (const operation of [insertRowBelow, insertColumnRight, deleteRow, deleteColumn]) {
      expect(operation(core.editor, core.gate)).toBe(false)
    }
    expect(exported(core)).toBe(before)
    expect(core.editor.getEditorState()).toBe(state)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('returns false without a selection', () => {
    const { core } = create(WITH_HEADER)
    core.editor.update(() => $setSelection(null), { discrete: true })
    expect(insertRowBelow(core.editor, core.gate)).toBe(false)
    expect(exported(core)).toBe(WITH_HEADER)
  })

  it('waits out a composition', () => {
    vi.useFakeTimers()
    const { core } = create(WITH_HEADER)
    caretIn(core, 1, 0)
    core.gate.begin()
    expect(insertRowBelow(core.editor, core.gate)).toBe(true)
    expect(size(exported(core)).rows).toBe(3)
    core.gate.end()
    vi.runAllTimers()
    expect(size(exported(core)).rows).toBe(4)
  })

  it('splits a merged cell back, keeping the column count', () => {
    const { core } = create(WITH_HEADER)
    // A pasted merged cell: one cell that spans the width of the table.
    core.editor.update(
      () => {
        const row = $row(1)
        row.getLastChildOrThrow().remove()
        row.getChildren().filter($isTableCellNode)[0]!.setColSpan(2)
      },
      { discrete: true },
    )
    expect(size(exported(core)).columns).toBe(2)
    expect(core.editor.read(() => $row(1).getChildrenSize())).toBe(2)
  })
})

describe('table operations on a table without a header', () => {
  it('inserts a row and a column and keeps every row a body row', () => {
    const { core } = create(HEADERLESS)
    caretIn(core, 0, 0)
    insertRowBelow(core.editor, core.gate)
    expect(exported(core)).toBe('|  |  |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |')
    caretIn(core, 0, 1)
    insertColumnRight(core.editor, core.gate)
    const markdown = exported(core)
    expect(markdown).toBe('|  |  |  |\n| --- | --- | --- |\n| 1 | 2 |  |\n|  |  |  |\n| 3 | 4 |  |')
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('removes the table with its only body row, and keeps the rest when a row is left', () => {
    const only = create('| | |\n| --- | --- |\n| 1 | 2 |')
    caretIn(only.core, 0, 0)
    deleteRow(only.core.editor, only.core.gate)
    expect(exported(only.core)).toBe('')

    const { core } = create(HEADERLESS)
    caretIn(core, 0, 0)
    deleteRow(core.editor, core.gate)
    const markdown = exported(core)
    expect(markdown).toBe('|  |  |\n| --- | --- |\n| 3 | 4 |')
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('deletes a column and round-trips', () => {
    const { core } = create(HEADERLESS)
    caretIn(core, 1, 0)
    deleteColumn(core.editor, core.gate)
    const markdown = exported(core)
    expect(markdown).toBe('|  |\n| --- |\n| 2 |\n| 4 |')
    expect(roundTrip(markdown)).toBe(markdown)
  })
})

describe('table operations and alignment', () => {
  const ALIGNED = '| a | b |\n| :-: | --: |\n| 1 | 2 |'

  it('gives a new row the alignment of its column, which survives deleting row 0', () => {
    const { core } = create(ALIGNED)
    caretIn(core, 1, 0)
    insertRowBelow(core.editor, core.gate)
    caretIn(core, 0, 0)
    deleteRow(core.editor, core.gate)
    expect(exported(core)).toBe('|  |  |\n| :---: | ---: |\n| 1 | 2 |\n|  |  |')
  })

  it('adds an unaligned column and keeps the others aligned', () => {
    const { core } = create(ALIGNED)
    caretIn(core, 1, 0)
    insertColumnRight(core.editor, core.gate)
    expect(exported(core)).toBe('| a |  | b |\n| :---: | --- | ---: |\n| 1 |  | 2 |')
  })

  it('moves the alignment with a deleted column', () => {
    const { core } = create(ALIGNED)
    caretIn(core, 1, 0)
    deleteColumn(core.editor, core.gate)
    expect(exported(core)).toBe('| b |\n| ---: |\n| 2 |')
  })
})
