import { $findMatchingParent } from '@lexical/utils'
import {
  $addUpdateTag,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  COMMAND_PRIORITY_HIGH,
  HISTORY_PUSH_TAG,
  IS_APPLE,
  isModifierMatch,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical'
import { $isTableSelection } from '@lexical/table'
import type { CompositionGate } from './composition'

export type DropSide = 'before' | 'after'

/** A blank line of the note: an empty root paragraph. It is no block to move and no gap between blocks. */
const $isBlankLine = (node: LexicalNode): boolean => $isParagraphNode(node) && node.getChildrenSize() === 0

/**
 * The move is valid when both nodes are root children, they differ, and the block would
 * not stay where it is. Blank lines between the two count as blocks here, so a drop
 * across them still moves the block.
 */
function $canMove(fromKey: NodeKey, targetKey: NodeKey, side: DropSide): boolean {
  if (fromKey === targetKey) return false
  const root = $getRoot()
  const from = $getNodeByKey(fromKey)
  const target = $getNodeByKey(targetKey)
  if (!from || !target || !from.getParent()?.is(root) || !target.getParent()?.is(root)) return false
  return (side === 'before' ? from.getNextSibling() : from.getPreviousSibling())?.getKey() !== targetKey
}

/** Whether `moveBlock` with these arguments would change the document; the drop line shows only for those. */
export const canMoveBlock = (editor: LexicalEditor, fromKey: NodeKey, targetKey: NodeKey, side: DropSide): boolean =>
  editor.isEditable() && editor.read(() => $canMove(fromKey, targetKey, side))

function $move(fromKey: NodeKey, targetKey: NodeKey, side: DropSide): void {
  const from = $getNodeByKey(fromKey)!
  const target = $getNodeByKey(targetKey)!
  if (side === 'before') target.insertBefore(from)
  else target.insertAfter(from)
}

/**
 * Moves one root block next to another. Only that node moves: the blank lines that were
 * around it stay, and new neighbours get a blank line from the export's seam rule. The
 * selection is untouched, whether it is a range, a node or a table selection. A move that
 * leaves two lists of one type adjacent merges them (Lexical's own list transform), and
 * one undo restores both.
 *
 * False, with the document untouched, when the editor is read-only or the move would
 * change nothing. The answer is decided now; the update may wait out a composition, and
 * then checks again. One discrete update that is its own undo step.
 */
export function moveBlock(editor: LexicalEditor, gate: CompositionGate, fromKey: NodeKey, targetKey: NodeKey, side: DropSide): boolean {
  if (!canMoveBlock(editor, fromKey, targetKey, side)) return false
  gate.run(() =>
    editor.update(
      () => {
        if (editor.isEditable() && $canMove(fromKey, targetKey, side)) $move(fromKey, targetKey, side)
      },
      { discrete: true, tag: [HISTORY_PUSH_TAG] },
    ),
  )
  return true
}

/** The root block the selection is in; for a node selection, the first selected node's. */
function $caretBlock(): LexicalNode | null {
  const selection = $getSelection()
  const node = $isNodeSelection(selection)
    ? selection.getNodes()[0]
    : $isRangeSelection(selection) || $isTableSelection(selection)
      ? selection.anchor.getNode()
      : undefined
  // Not `getTopLevelElement`: a table cell is a shadow root, so it stops at the paragraph inside it.
  return node ? ($findMatchingParent(node, (parent) => $isRootNode(parent.getParent())) ?? null) : null
}

/** The caret block and the next non-empty block in `direction`, or null when there is none. */
function $caretMove(direction: 'up' | 'down'): { from: NodeKey; target: NodeKey; side: DropSide } | null {
  const block = $caretBlock()
  if (!block || $isBlankLine(block)) return null
  const step = (node: LexicalNode) => (direction === 'up' ? node.getPreviousSibling() : node.getNextSibling())
  let neighbour = step(block)
  while (neighbour && $isBlankLine(neighbour)) neighbour = step(neighbour)
  return neighbour ? { from: block.getKey(), target: neighbour.getKey(), side: direction === 'up' ? 'before' : 'after' } : null
}

/**
 * Moves the block holding the caret past the next non-empty block above or below it.
 * False when there is no such block, the caret is not in a block, or the caret is on a
 * blank line.
 */
export function moveCaretBlock(editor: LexicalEditor, gate: CompositionGate, direction: 'up' | 'down'): boolean {
  const move = editor.read(() => $caretMove(direction))
  return move !== null && moveBlock(editor, gate, move.from, move.target, move.side)
}

/**
 * Mod-Shift-ArrowUp / ArrowDown move the block holding the caret. The browser would
 * extend the selection to the start or end of the document or paragraph, so the keys
 * are claimed even when there is nowhere to move; a read-only editor keeps them.
 * Nothing happens during a composition.
 */
export function registerBlockKeys(editor: LexicalEditor, gate: CompositionGate): () => void {
  const mod = { metaKey: IS_APPLE, ctrlKey: !IS_APPLE, altKey: false, shiftKey: true }
  return editor.registerCommand(
    KEY_DOWN_COMMAND,
    (event) => {
      if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || !isModifierMatch(event, mod) || !editor.isEditable()) return false
      event.preventDefault()
      // A command runs inside an update, so the move happens in it instead of a nested one.
      const move = gate.active ? null : $caretMove(event.key === 'ArrowUp' ? 'up' : 'down')
      if (move && $canMove(move.from, move.target, move.side)) {
        $addUpdateTag(HISTORY_PUSH_TAG)
        $move(move.from, move.target, move.side)
      }
      return true
    },
    COMMAND_PRIORITY_HIGH,
  )
}

/** One root block as the pointer sees it. `top` and `bottom` are client coordinates. */
export interface BlockBox {
  key: NodeKey
  top: number
  bottom: number
  blank: boolean
}

/** The root blocks that are rendered, with their rects. */
export function rootBlockBoxes(editor: LexicalEditor): BlockBox[] {
  const blocks = editor.read(() => $getRoot().getChildren().map((node) => ({ key: node.getKey(), blank: $isBlankLine(node) })))
  return blocks.flatMap(({ key, blank }) => {
    const rect = editor.getElementByKey(key)?.getBoundingClientRect()
    return rect ? [{ key, blank, top: rect.top, bottom: rect.bottom }] : []
  })
}

/**
 * Index of the block under `y` by binary search on `top` (the root children are in
 * document order): the last block that starts at or above `y`, or -1. A gap between two
 * blocks belongs to the one above it.
 */
export function blockIndexAt(boxes: readonly BlockBox[], y: number): number {
  let low = 0
  let high = boxes.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (boxes[middle]!.top <= y) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

export interface DropPoint {
  key: NodeKey
  side: DropSide
  /** Client y of the edge the drop line is drawn at. */
  line: number
}

/**
 * The gap between two non-empty blocks (or before the first, after the last) nearest to
 * `y`, as the edge it is drawn at: the bottom edge of the block above means "after" it, the
 * top edge of the block below means "before" it. Across blank lines the two edges differ,
 * and the one nearer the pointer decides which side of the blank lines the block lands.
 */
export function dropPointAt(boxes: readonly BlockBox[], y: number): DropPoint | null {
  const index = blockIndexAt(boxes, y)
  let above = index
  while (above >= 0 && boxes[above]!.blank) above--
  let below = index + 1
  while (below < boxes.length && boxes[below]!.blank) below++
  const edges: DropPoint[] = [
    ...(above >= 0 ? [{ key: boxes[above]!.key, side: 'before' as const, line: boxes[above]!.top }, { key: boxes[above]!.key, side: 'after' as const, line: boxes[above]!.bottom }] : []),
    ...(below < boxes.length ? [{ key: boxes[below]!.key, side: 'before' as const, line: boxes[below]!.top }, { key: boxes[below]!.key, side: 'after' as const, line: boxes[below]!.bottom }] : []),
  ]
  let best: DropPoint | null = null
  for (const edge of edges) if (!best || Math.abs(edge.line - y) < Math.abs(best.line - y)) best = edge
  return best
}
