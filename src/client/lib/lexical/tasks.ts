import { $isListItemNode, $isListNode } from '@lexical/list'
import { $getNodeByKey, type LexicalEditor, type NodeKey } from 'lexical'
import type { CompositionGate } from './composition'

/** Extra reach around the mark for a finger, as in Lexical's own check list. */
const TOUCH_PADDING = 32

/**
 * Whether a pointer at `clientX` is on the task mark drawn by the item's `::before`
 * box, which spans `markerWidth` from the item's start edge. This is Lexical's own
 * check list rule, which is not exported. `zoom` is the page zoom: `clientX` is
 * divided by it, while the rect and the box width are already in the item's pixels.
 */
export function isCheckMarkHit(p: {
  clientX: number
  left: number
  right: number
  markerWidth: number
  rtl: boolean
  touch: boolean
  zoom: number
}): boolean {
  const x = p.clientX / p.zoom
  const pad = p.touch ? TOUCH_PADDING : 0
  return p.rtl ? x < p.right + pad && x > p.right - p.markerWidth - pad : x > p.left - pad && x < p.left + p.markerWidth + pad
}

/**
 * Flips the task item `key`. An update is allowed while the editor is not editable,
 * which is how a locked note keeps its checkboxes. Goes through the gate so it never
 * lands in the middle of an IME composition.
 */
export function toggleTask(editor: LexicalEditor, gate: CompositionGate, key: NodeKey): void {
  gate.run(() =>
    editor.update(() => {
      const item = $getNodeByKey(key)
      if (!$isListItemNode(item)) return
      const list = item.getParent()
      if ($isListNode(list) && list.getListType() === 'check') item.toggleChecked()
    }),
  )
}
