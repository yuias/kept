import type { Transformer } from '@lexical/markdown'
import { $findMatchingParent } from '@lexical/utils'
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  CLEAR_HISTORY_COMMAND,
  HISTORY_MERGE_TAG,
  SKIP_DOM_SELECTION_TAG,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
} from 'lexical'
import type { CompositionGate } from './composition'
import { $exportMarkdown, $importMarkdown } from './markdown'

/** Marks updates the app makes itself (initial load, external value); they never reach `onChange`. */
export const EXTERNAL_TAG = 'kept-external'

/** A caret as the index of its root child and the character offset inside that child's leaves. */
interface Caret {
  index: number
  offset: number
}

// Offsets count the characters of the leaves plus the two-character separator that
// `getTextContent` puts between block children (items of a list, cells of a row), so
// the end of one item and the start of the next are different positions.
const SEPARATOR = 2
const $hasSeparator = (parent: ElementNode, index: number, child: LexicalNode): boolean =>
  $isElementNode(child) && !child.isInline() && index < parent.getChildrenSize() - 1

function $caretOf(point: PointType): Caret {
  const node = point.getNode()
  if ($isRootNode(node)) return { index: point.offset, offset: 0 }
  // Not getTopLevelElement: a table cell is a shadow root and would stop there.
  const block = $findMatchingParent(node, (parent) => $isRootNode(parent.getParent())) as ElementNode
  let offset = 0
  const $walk = (parent: ElementNode): boolean => {
    for (const [i, child] of parent.getChildren().entries()) {
      if (parent.is(node) && point.offset === i) return true
      if ($isElementNode(child)) {
        if ($walk(child)) return true
      } else if (child.is(node)) {
        offset += point.offset
        return true
      } else {
        offset += child.getTextContentSize()
      }
      if ($hasSeparator(parent, i, child)) offset += SEPARATOR
    }
    return parent.is(node)
  }
  $walk(block)
  return { index: block.getIndexWithinParent(), offset }
}

function $restoreCaret({ index, offset }: Caret): void {
  const root = $getRoot()
  const block = root.getChildAtIndex(Math.min(index, root.getChildrenSize() - 1))!
  // A decorator (rule, card) holds no text: put the caret next to it.
  if (!$isElementNode(block)) {
    block.selectNext()
    return
  }
  let remaining = offset
  const $place = (parent: ElementNode): boolean => {
    if (parent.isEmpty()) {
      parent.select(0, 0)
      return true
    }
    for (const [i, child] of parent.getChildren().entries()) {
      const size = child.getTextContentSize()
      if (remaining <= size) {
        if ($isElementNode(child)) {
          if ($place(child)) return true
        } else {
          if ($isTextNode(child)) child.select(remaining, remaining)
          else if (remaining === 0) child.selectPrevious()
          else child.selectNext()
          return true
        }
      }
      remaining -= size
      // An offset inside the separator lands at the start of the next block.
      if ($hasSeparator(parent, i, child)) remaining = Math.max(0, remaining - SEPARATOR)
    }
    return false
  }
  if (!$place(block)) block.selectEnd()
}

/** Replaces the document with `markdown`; the caret stays at the same place, clamped to the new text. */
export function $replaceDocument(markdown: string, transformers: Transformer[]): void {
  const selection = $getSelection()
  const caret = $isRangeSelection(selection) ? $caretOf(selection.anchor) : null
  $importMarkdown(markdown, transformers)
  const root = $getRoot()
  if (root.isEmpty()) root.append($createParagraphNode())
  if (caret) $restoreCaret(caret)
}

export interface ExternalValueOptions {
  transformers: Transformer[]
  /** Seams of the document as it is now. */
  seams: () => ReadonlySet<string>
  /** Number of user changes emitted so far; a value queued before one of them is dropped. */
  edits: () => number
  /** Runs once the new document is committed: record its seams and baseline, run the fidelity guard. */
  onReplaced: (markdown: string) => void
}

/** True when the editor has a root that does not hold the focus; updates then must not pull it in. */
export function isBlurred(editor: LexicalEditor): boolean {
  const root = editor.getRootElement()
  return root !== null && typeof document !== 'undefined' && !root.contains(document.activeElement)
}

/**
 * Makes the document `markdown` unless it already exports to exactly that. The
 * replace runs through the composition gate, tagged so that no change event or
 * typing shortcut sees it. A value that waited out a composition is dropped if
 * the user changed the text meanwhile: their text wins.
 */
export function applyExternalValue(editor: LexicalEditor, gate: CompositionGate, markdown: string, options: ExternalValueOptions): void {
  const edits = options.edits()
  gate.run(() => {
    if (options.edits() !== edits) return
    if (editor.read(() => $exportMarkdown(options.transformers, options.seams())) === markdown) return
    // Restoring the caret must not pull focus into an editor the user has left.
    const blurred = isBlurred(editor)
    editor.update(
      () => {
        $replaceDocument(markdown, options.transformers)
        // Undo across a whole-document replace would point at nodes that no longer exist.
        // Cleared inside the update that replaces, so a failed replace keeps the history,
        // and the merge-tagged update then becomes the history's base state: clearing
        // afterwards would leave no base and the first edit would not be an undo step.
        editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
      },
      { tag: blurred ? [HISTORY_MERGE_TAG, EXTERNAL_TAG, SKIP_DOM_SELECTION_TAG] : [HISTORY_MERGE_TAG, EXTERNAL_TAG], discrete: true },
    )
    options.onReplaced(markdown)
  })
}
