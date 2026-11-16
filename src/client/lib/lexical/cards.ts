import {
  $createNodeSelection,
  $getNodeByKey,
  $setSelection,
  HISTORY_PUSH_TAG,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type NodeKey,
} from 'lexical'
import { cardMarkup, parseCardLine } from '../../../shared/link-card'
import type { CompositionGate } from './composition'
import { $isCardNode } from './nodes/card-node'
import { isBlurred } from './sync'

/** The URL a card would hold after a reload of its markup, or null when it cannot be a card. */
export function parseCardUrl(input: string): string | null {
  return parseCardLine(cardMarkup(input.trim()))
}

/** Removes the card the way Backspace on a selected card does, so the caret and an empty root are handled alike. */
export function $removeCard(key: NodeKey): boolean {
  const node = $getNodeByKey(key)
  if (!$isCardNode(node)) return false
  const selection = $createNodeSelection()
  selection.add(key)
  $setSelection(selection)
  selection.deleteNodes()
  return true
}

/**
 * Points the card at `url`; an empty value removes it. False, with the
 * document untouched, when `url` is not one a card line can hold.
 */
export function $setCardUrl(key: NodeKey, url: string): boolean {
  const node = $getNodeByKey(key)
  if (!$isCardNode(node)) return false
  if (url.trim() === '') return $removeCard(key)
  const next = parseCardUrl(url)
  if (next === null) return false
  if (next !== node.getURL()) node.setURL(next)
  return true
}

export function $selectCard(key: NodeKey): void {
  if (!$isCardNode($getNodeByKey(key))) return
  const selection = $createNodeSelection()
  selection.add(key)
  $setSelection(selection)
}

/** The card operations of the views. Each one runs through the composition gate and commits one update. */
export function createCardOps(editor: LexicalEditor, gate: CompositionGate) {
  const tags = (): string[] => (isBlurred(editor) ? [HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG] : [HISTORY_PUSH_TAG])
  return {
    /**
     * Whether `url` is accepted, decided now; the update itself may wait out a
     * composition. An empty value removes the card.
     */
    setUrl(key: NodeKey, url: string): boolean {
      if (url.trim() !== '' && parseCardUrl(url) === null) return false
      // Its own undo step: typing right before it would otherwise merge with it.
      gate.run(() => editor.update(() => void $setCardUrl(key, url), { discrete: true, tag: tags() }))
      return true
    },
    /** Node-selects the card, so that Backspace and Delete remove it, and moves the focus to the editor for them. */
    select(key: NodeKey): void {
      gate.run(() => {
        if (isBlurred(editor)) editor.getRootElement()?.focus({ preventScroll: true })
        editor.update(() => $selectCard(key), { discrete: true })
      })
    },
  }
}

export type CardOps = ReturnType<typeof createCardOps>
