import { $isCodeNode } from '@lexical/code-core'
import { $generateNodesFromMarkdownString, type Transformer } from '@lexical/markdown'
import { $isTableCellNode } from '@lexical/table'
import { $dfs, $findMatchingParent } from '@lexical/utils'
import {
  $addUpdateTag,
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isInlineElementOrDecoratorNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  HISTORY_PUSH_TAG,
  PASTE_TAG,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
  type TextNode,
} from 'lexical'
import { toLf } from '../line-endings'
import type { CompositionGate } from './composition'
import { $isImageNode, type ImageNode } from './nodes/image-node'
import { isBlurred } from './sync'

/** The image whose markdown is `token`, else the first text node that holds it (code blocks, edited placeholders). */
function $findPlaceholder(token: string): ImageNode | TextNode | null {
  const nodes = $dfs().map(({ node }) => node)
  const image = nodes.find((node): node is ImageNode => $isImageNode(node) && node.getTextContent() === token)
  return image ?? nodes.find((node): node is TextNode => $isTextNode(node) && node.getTextContent().includes(token)) ?? null
}

/** The nodes of `markdown`; a lone paragraph gives its children so that they land inside the surrounding line. */
function $nodesOf(markdown: string, transformers: Transformer[]): LexicalNode[] {
  const nodes = $generateNodesFromMarkdownString(markdown, transformers, true)
  const [only] = nodes
  return nodes.length === 1 && $isParagraphNode(only) ? only.getChildren() : nodes
}

const $collapsedAt = (point: { key: string; offset: number; type: 'text' | 'element' }): RangeSelection => {
  const selection = $createRangeSelection()
  selection.anchor.set(point.key, point.offset, point.type)
  selection.focus.set(point.key, point.offset, point.type)
  return selection
}

/**
 * Inserts `markdown` after the selection (which stays unreplaced), or at the end
 * of the document when there is no range selection. The caret ends up after it.
 * Inside a code block the text goes in as it is.
 */
export function $insertMarkdown(markdown: string, transformers: Transformer[]): void {
  const current = $getSelection()
  let selection: RangeSelection
  if ($isRangeSelection(current)) {
    selection = $collapsedAt(current.isBackward() ? current.anchor : current.focus)
    $setSelection(selection)
  } else {
    const last = $getRoot().getLastChild()
    const paragraph = $isParagraphNode(last) ? last : $createParagraphNode()
    if (paragraph !== last) $getRoot().append(paragraph)
    selection = paragraph.selectEnd()
  }
  if ($findMatchingParent(selection.anchor.getNode(), $isCodeNode)) {
    selection.insertText(markdown)
    return
  }
  const nodes = $nodesOf(markdown, transformers)
  if (nodes.length > 0) selection.insertNodes(nodes)
}

/**
 * Pastes clipboard text as markdown over the selection, in place of Lexical's
 * plain-text paste. Clipboards with HTML or Lexical's own data are left to Lexical
 * (false), as are table cells (they hold inline content only, which block markdown
 * would break) and clipboards without text. Inside a code block the text goes in as it
 * is, line breaks included. CR and CRLF become LF first. Call inside the paste command.
 */
export function $pasteMarkdown(event: ClipboardEvent, transformers: Transformer[]): boolean {
  const data = event.clipboardData
  const selection = $getSelection()
  if (!data || !$isRangeSelection(selection)) return false
  if (data.getData('text/html') !== '' || data.getData('application/x-lexical-editor') !== '') return false
  const text = toLf(data.getData('text/plain'))
  if (text === '') return false
  const nodes = [selection.anchor, selection.focus].map((point) => point.getNode())
  if (nodes.some((node) => $findMatchingParent(node, $isTableCellNode))) return false
  const inCode = nodes.some((node) => $findMatchingParent(node, $isCodeNode))
  // A copied line usually ends in a line break, which would leave an empty paragraph behind.
  const line = text.replace(/\n+$/, '')
  // Nothing but line breaks: Lexical's own paste turns them into paragraphs.
  if (!inCode && line === '') return false
  const imported = inCode ? [] : $nodesOf(line, transformers)
  event.preventDefault()
  // Its own undo step, like Lexical's own paste.
  $addUpdateTag(PASTE_TAG)
  if (inCode) selection.insertRawText(text)
  else selection.insertNodes(imported)
  return true
}

/** Replaces the placeholder `token` with `markdown`, or removes it when `markdown` is empty. False when it is gone. */
export function $replacePlaceholder(token: string, markdown: string, transformers: Transformer[]): boolean {
  const found = $findPlaceholder(token)
  if (!found) return false
  let target: LexicalNode = found
  if ($isTextNode(found)) {
    const size = found.getTextContentSize()
    const start = found.getTextContent().indexOf(token)
    const parts = found.splitText(...[start, start + token.length].filter((offset) => offset > 0 && offset < size))
    target = parts[start > 0 ? 1 : 0]!
    if ($findMatchingParent(target, $isCodeNode)) {
      if (markdown === '') target.remove()
      else (target as TextNode).setTextContent(markdown)
      return true
    }
  }
  const nodes = markdown === '' ? [] : $nodesOf(markdown, transformers)
  if (nodes.every((node) => $isTextNode(node) || $isLineBreakNode(node) || $isInlineElementOrDecoratorNode(node))) {
    // Inline nodes take the place of the placeholder, so the line keeps its other content.
    let previous = target
    for (const node of nodes) {
      previous.insertAfter(node)
      previous = node
    }
    target.remove()
    return true
  }
  const parent = target.getParentOrThrow()
  const selection = $collapsedAt({ key: parent.getKey(), offset: target.getIndexWithinParent(), type: 'element' })
  target.remove()
  $setSelection(selection)
  selection.insertNodes(nodes)
  return true
}

/**
 * `insertText` and `replaceText` of the editor handle. Both run through the
 * composition gate and commit one update each, tagged so that `onChange` sees it.
 * `flush` applies what is still queued; it is for the editor being destroyed,
 * because a replacement dropped there would leave the placeholder in the note.
 */
export function createPlaceholderOps(editor: LexicalEditor, gate: CompositionGate, transformers: Transformer[]) {
  const queued = new Set<() => void>()
  const enqueue = (work: () => void): void => {
    const op = (): void => {
      queued.delete(op)
      work()
    }
    queued.add(op)
    gate.run(op)
  }
  const tags = (...base: string[]): string[] => (isBlurred(editor) ? [...base, SKIP_DOM_SELECTION_TAG] : base)
  const hasPlaceholder = (token: string): boolean => editor.getEditorState().read(() => $findPlaceholder(token) !== null)

  return {
    insertText(markdown: string): void {
      // Its own undo step: typing right before it would otherwise merge with it.
      enqueue(() => editor.update(() => $insertMarkdown(markdown, transformers), { discrete: true, tag: tags(HISTORY_PUSH_TAG) }))
    },
    replaceText(token: string, markdown: string): boolean {
      const result: { done?: boolean } = {}
      enqueue(() => {
        // Read first: a placeholder that is gone must not commit an update.
        result.done = hasPlaceholder(token)
        if (result.done) editor.update(() => void $replacePlaceholder(token, markdown, transformers), { discrete: true, tag: tags() })
      })
      // Still queued behind a composition: the placeholder is there now, and the queued
      // operation looks for it again when it runs.
      return result.done ?? hasPlaceholder(token)
    },
    flush(): void {
      for (const op of [...queued]) op()
    },
  }
}
