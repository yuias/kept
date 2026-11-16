import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableSelection,
} from '@lexical/table'
import { $findMatchingParent } from '@lexical/utils'
import { $createParagraphNode, $getRoot, $getSelection, $isRangeSelection, $setSelection, HISTORY_PUSH_TAG, type LexicalEditor, type NodeKey } from 'lexical'
import type { CompositionGate } from './composition'

/** The table holding the selection anchor, or null: the helpers throw outside a table and without a selection. */
function $tableAtCaret(): NodeKey | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) && !$isTableSelection(selection)) return null
  const cell = $findMatchingParent(selection.anchor.getNode(), $isTableCellNode)
  return cell ? ($findMatchingParent(cell, $isTableNode)?.getKey() ?? null) : null
}

/** Key of the table the caret is in, by the same rule every operation below checks first. */
export const tableAtCaret = (editor: LexicalEditor): NodeKey | null => editor.read($tableAtCaret)

/**
 * False, with the document untouched, when the caret is not in a table cell. The
 * answer is decided now; the update may wait out a composition, and then checks again.
 * One discrete update that is its own undo step, so it cannot merge with typing.
 */
function runInTable(editor: LexicalEditor, gate: CompositionGate, operation: () => void, keepCaret = false): boolean {
  if (tableAtCaret(editor) === null) return false
  gate.run(() =>
    editor.update(
      () => {
        if ($tableAtCaret() === null) return
        const caret = keepCaret ? $getSelection() : null
        const cell = $isRangeSelection(caret) || $isTableSelection(caret) ? $findMatchingParent(caret.anchor.getNode(), $isTableCellNode) : null
        const saved = $isRangeSelection(caret) ? caret.clone() : null
        operation()
        // The insert helpers move the caret to a new cell, so a following delete would act on
        // another row or column than the one the user was on.
        if (cell?.isAttached()) {
          if (saved) $setSelection(saved)
          else cell.selectStart()
        }
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

export const insertRowBelow = (editor: LexicalEditor, gate: CompositionGate): boolean => runInTable(editor, gate, $insertRowBelow, true)

export const insertColumnRight = (editor: LexicalEditor, gate: CompositionGate): boolean =>
  runInTable(editor, gate, () => void $insertTableColumnAtSelection(true), true)

export const deleteRow = (editor: LexicalEditor, gate: CompositionGate): boolean =>
  runInTable(editor, gate, $deleteTableRowAtSelection)

export const deleteColumn = (editor: LexicalEditor, gate: CompositionGate): boolean =>
  runInTable(editor, gate, $deleteTableColumnAtSelection)
