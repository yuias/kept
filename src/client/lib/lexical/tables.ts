import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableRowNode,
  $isTableSelection,
} from '@lexical/table'
import { $findMatchingParent } from '@lexical/utils'
import { $createParagraphNode, $getRoot, $getSelection, $isRangeSelection, HISTORY_PUSH_TAG, type LexicalEditor } from 'lexical'
import type { CompositionGate } from './composition'

/** The table helpers throw outside a table and without a selection, so every operation checks first. */
function $inTableCell(): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) && !$isTableSelection(selection)) return false
  return $findMatchingParent(selection.anchor.getNode(), $isTableCellNode) !== null
}

/**
 * False, with the document untouched, when the caret is not in a table cell. The
 * answer is decided now; the update may wait out a composition, and then checks again.
 * One discrete update that is its own undo step, so it cannot merge with typing.
 */
function runInTable(editor: LexicalEditor, gate: CompositionGate, operation: () => void): boolean {
  if (!editor.read($inTableCell)) return false
  gate.run(() =>
    editor.update(
      () => {
        if (!$inTableCell()) return
        operation()
        // Deleting the last row or column of a lone table leaves a root nothing can be typed into.
        const root = $getRoot()
        if (root.isEmpty()) root.append($createParagraphNode()).select()
      },
      { discrete: true, tag: [HISTORY_PUSH_TAG] },
    ),
  )
  return true
}

/**
 * Alignment lives on every cell but the export reads it from row 0, so a new row
 * takes it from the row above. Otherwise deleting row 0 later would drop the
 * column alignment, and the new cells would render unaligned until a reload.
 */
function $insertRowBelow(): void {
  const row = $insertTableRowAtSelection(true)
  const above = row?.getPreviousSibling()
  if (!$isTableRowNode(above)) return
  const formats = above.getChildren().filter($isTableCellNode).map((cell) => cell.getFormatType())
  row!.getChildren().filter($isTableCellNode).forEach((cell, column) => void cell.setFormat(formats[column] ?? ''))
}

export const insertRowBelow = (editor: LexicalEditor, gate: CompositionGate): boolean => runInTable(editor, gate, $insertRowBelow)

export const insertColumnRight = (editor: LexicalEditor, gate: CompositionGate): boolean =>
  runInTable(editor, gate, () => void $insertTableColumnAtSelection(true))

export const deleteRow = (editor: LexicalEditor, gate: CompositionGate): boolean =>
  runInTable(editor, gate, $deleteTableRowAtSelection)

export const deleteColumn = (editor: LexicalEditor, gate: CompositionGate): boolean =>
  runInTable(editor, gate, $deleteTableColumnAtSelection)
