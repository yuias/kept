import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  HISTORY_PUSH_TAG,
  KEY_ESCAPE_COMMAND,
  COMMAND_PRIORITY_HIGH,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type NodeKey,
} from 'lexical'
import { parseCardUrl } from './cards'
import type { CompositionGate } from './composition'
import { $createCardNode } from './nodes/card-node'
import { isBlurred } from './sync'

const URL_TEXT = /^https?:\/\/\S+$/

/** A URL that was pasted into an empty line and can still become a card. */
export interface PendingUrl {
  key: NodeKey
  url: string
}

function isParsableUrl(text: string): boolean {
  try {
    new URL(text)
    return true
  } catch {
    return false
  }
}

/**
 * The URL to offer a choice for when `text` is one http(s) URL pasted into an
 * empty root-level paragraph with a collapsed selection; code blocks, list
 * items, quotes and table cells never qualify. Pure read.
 */
export function $detectUrlPaste(text: string): PendingUrl | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  const url = text.trim()
  if (!URL_TEXT.test(url) || !isParsableUrl(url)) return null
  const paragraph = selection.anchor.getNode()
  if (!$isParagraphNode(paragraph) || !$isRootNode(paragraph.getParent()) || !paragraph.isEmpty()) return null
  return { key: paragraph.getKey(), url }
}

/** Inserts the URL when `text` is a lone URL paste (see `$detectUrlPaste`). The auto link transform then links it. */
export function $insertPastedUrl(text: string): PendingUrl | null {
  const hit = $detectUrlPaste(text)
  if (!hit) return null
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return null
  selection.insertText(hit.url)
  return hit
}

/**
 * Replaces the paragraph `key` with a card for its URL and puts the caret in the
 * paragraph after it, which is created when the card is last or followed by
 * something else. False, with the document untouched, when the paragraph is gone
 * or no longer holds a URL a card can show.
 */
export function $applyCardChoice(key: NodeKey): boolean {
  const paragraph = $getNodeByKey(key)
  if (!$isParagraphNode(paragraph) || !$isRootNode(paragraph.getParent())) return false
  const url = parseCardUrl(paragraph.getTextContent())
  if (url === null) return false
  const card = $createCardNode(url)
  paragraph.replace(card)
  let next = card.getNextSibling()
  if (!$isParagraphNode(next)) {
    next = $createParagraphNode()
    card.insertAfter(next)
  }
  next.selectStart()
  return true
}

export interface UrlPasteController {
  /** The pasted URL a choice is offered for, once its paste has been committed. */
  readonly pending: PendingUrl | null
  /** `listener` gets the pending URL when the choice opens and `null` when it closes. */
  subscribe(listener: (pending: PendingUrl | null) => void): () => void
  /** The paste decision. Call inside the paste command; true when the paste was taken (the event is prevented). */
  paste(event: ClipboardEvent): boolean
  close(): void
  /** Turns the pending paragraph into a card as its own undo step, through the composition gate. */
  chooseCard(): void
  destroy(): void
}

/**
 * Holds the choice offered after a lone URL paste. It closes when the user
 * chooses, presses Esc, or edits: any commit after which the paragraph no longer
 * holds exactly the URL with the caret in it.
 */
export function createUrlPaste(editor: LexicalEditor, gate: CompositionGate): UrlPasteController {
  let pending: PendingUrl | null = null
  // Set from the commit after the paste, when the paragraph's element exists.
  let announced = false
  const listeners = new Set<(pending: PendingUrl | null) => void>()
  const emit = (value: PendingUrl | null): void => {
    for (const listener of [...listeners]) listener(value)
  }

  const close = (): void => {
    if (pending === null) return
    pending = null
    if (announced) emit(null)
    announced = false
  }

  const $stillPending = (): boolean => {
    if (pending === null) return false
    const paragraph = $getNodeByKey(pending.key)
    const selection = $getSelection()
    return (
      $isParagraphNode(paragraph) &&
      paragraph.getTextContent() === pending.url &&
      $isRangeSelection(selection) &&
      selection.isCollapsed() &&
      paragraph.isParentOf(selection.anchor.getNode())
    )
  }

  const unregister = [
    editor.registerUpdateListener(({ editorState }) => {
      if (pending === null) return
      if (!editorState.read($stillPending)) {
        close()
      } else if (!announced) {
        announced = true
        emit(pending)
      }
    }),
    // The choice would edit a note that was locked meanwhile.
    editor.registerEditableListener((editable) => {
      if (!editable) close()
    }),
    // Before the rich text handler that blurs the editor, so the dialog stays open.
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        if (pending === null) return false
        event.preventDefault()
        close()
        return true
      },
      COMMAND_PRIORITY_HIGH,
    ),
  ]

  return {
    get pending() {
      return pending
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    paste(event) {
      if (gate.active || !editor.isEditable()) return false
      // No `clipboardData` when the paste arrives as an `insertFromPaste` input event.
      const text = event.clipboardData?.getData('text/plain')
      const hit = text ? $insertPastedUrl(text) : null
      if (!hit) return false
      event.preventDefault()
      close()
      pending = hit
      return true
    },
    close,
    chooseCard() {
      if (pending === null) return
      const { key } = pending
      close()
      // Its own undo step, so one undo returns to the plain URL.
      const tag = isBlurred(editor) ? [HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG] : [HISTORY_PUSH_TAG]
      gate.run(() => editor.update(() => void $applyCardChoice(key), { discrete: true, tag }))
    },
    destroy() {
      for (const off of unregister) off()
      listeners.clear()
      pending = null
    },
  }
}
