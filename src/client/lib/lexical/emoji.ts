import { $isCodeNode } from '@lexical/code-core'
import { $findMatchingParent, $getNearestBlockElementAncestorOrThrow } from '@lexical/utils'
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COLLABORATION_TAG,
  HISTORIC_TAG,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
  PASTE_TAG,
  type TextNode,
} from 'lexical'
import type { CompositionGate } from './composition'
import { EXTERNAL_TAG } from './sync'

export interface EmojiEntry {
  name: string
  emoji: string
}

export interface EmojiIndex {
  /** One entry per shortcode name, in the order of the source list. */
  entries: readonly EmojiEntry[]
  byName: ReadonlyMap<string, string>
}

export function buildEmojiIndex(list: ReadonlyArray<{ emoji: string; names: readonly string[] }>): EmojiIndex {
  const entries = list.flatMap(({ emoji, names }) => names.map((name) => ({ name: name.toLowerCase(), emoji })))
  const byName = new Map<string, string>()
  for (const { name, emoji } of entries) if (!byName.has(name)) byName.set(name, emoji)
  return { entries, byName }
}

let loaded: EmojiIndex | undefined
let loading: Promise<EmojiIndex | null> | undefined

export const loadedEmojiIndex = (): EmojiIndex | undefined => loaded

/**
 * The shortcode list is about 360 KB, so it is a chunk of its own that nothing loads before
 * the first `:` that can start a shortcode. Null when the chunk could not be fetched; the
 * next call tries again.
 */
export function loadEmojiIndex(): Promise<EmojiIndex | null> {
  loading ??= import('gemoji').then(
    ({ gemoji }) => (loaded = buildEmojiIndex(gemoji)),
    () => {
      loading = undefined
      return null
    },
  )
  return loading
}

/** Names that start with `query` come first, then names that contain it; each group in list order. */
export function matchEmoji(index: EmojiIndex, query: string, limit: number): EmojiEntry[] {
  const needle = query.toLowerCase()
  const starting: EmojiEntry[] = []
  const containing: EmojiEntry[] = []
  for (const entry of index.entries) {
    const at = entry.name.indexOf(needle)
    if (at === 0) starting.push(entry)
    else if (at > 0) containing.push(entry)
    if (starting.length >= limit) break
  }
  return [...starting, ...containing].slice(0, limit)
}

interface Shortcode {
  /** Offset of the opening `:`. */
  start: number
  name: string
  closed: boolean
}

/**
 * The shortcode that ends at `caret`: `:name` or `:name:`. The opening colon must start the
 * text or follow anything but an ASCII letter, digit, `:` or `/`, so `12:30`, `a:b` and
 * `http://` never match while Japanese text, which has no spaces, still does.
 */
function shortcodeBefore(text: string, caret: number, minLength: number): Shortcode | null {
  const match = /:([a-z0-9_+-]*)(:?)$/.exec(text.slice(0, caret))
  if (!match) return null
  const [, name = '', closing] = match
  const closed = closing === ':'
  if (name.length < (closed ? 1 : minLength) || (match.index > 0 && /[A-Za-z0-9:/]/.test(text.charAt(match.index - 1)))) return null
  return { start: match.index, name, closed }
}

export interface ShortcodeQuery {
  /** The characters after the colon. */
  query: string
  /** Identifies this shortcode (text node and offset of its colon), so a dismissed menu stays dismissed. */
  id: string
}

/** The open `:name` right before a collapsed caret where the emoji menu belongs, or null. */
export function shortcodeQuery(editor: LexicalEditor): ShortcodeQuery | null {
  return editor.read(() => {
    const selection = $getSelection()
    if (!editor.isEditable() || editor.isComposing() || !$isRangeSelection(selection) || !selection.isCollapsed()) return null
    const { anchor } = selection
    const node = anchor.getNode()
    if (anchor.type !== 'text' || !$isTextNode(node) || node.hasFormat('code') || $findMatchingParent(node, $isCodeNode)) return null
    const code = shortcodeBefore(node.getTextContent(), anchor.offset, 2)
    return code && !code.closed ? { query: code.name, id: `${node.getKey()}:${code.start}` } : null
  })
}

/**
 * Replaces the shortcode before the caret with `emoji`, caret after it: `:name`, or `:name:`
 * when the closing colon is there, in either place (before or right after the caret).
 */
export function $replaceShortcode(emoji: string): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
  const { anchor } = selection
  const node = anchor.getNode()
  if (anchor.type !== 'text' || !$isTextNode(node)) return false
  const text = node.getTextContent()
  const code = shortcodeBefore(text, anchor.offset, 1)
  if (!code) return false
  const end = anchor.offset + (!code.closed && text.charAt(anchor.offset) === ':' ? 1 : 0)
  node.spliceText(code.start, end - code.start, emoji, true)
  return true
}

/** Picks an emoji in the menu: its own undo step, held back while an IME composition runs. */
export function pickEmoji(editor: LexicalEditor, gate: CompositionGate, emoji: string): void {
  gate.run(() => editor.update(() => void $replaceShortcode(emoji), { discrete: true, tag: [HISTORY_PUSH_TAG] }))
}

/**
 * Whether an odd number of backticks come before `offset` in the node's block. The shortcode
 * then sits in what becomes inline code once its closing backtick is typed, which is too late
 * to see in the format of the text.
 */
function $afterOpenBacktick(node: TextNode, offset: number): boolean {
  let before = ''
  for (const text of $getNearestBlockElementAncestorOrThrow(node).getAllTextNodes()) {
    if (text.is(node)) {
      before += text.getTextContent().slice(0, offset)
      break
    }
    before += text.getTextContent()
  }
  return (before.match(/`/g)?.length ?? 0) % 2 === 1
}

/**
 * Replaces `:name:` at `start` of the text node `key` with `emoji`, if that text is still
 * there and still outside code. The caret ends up after the emoji when it was right after the
 * shortcode, and keeps its place in the text otherwise.
 */
function $replaceShortcodeAt(key: string, start: number, name: string, emoji: string): void {
  const node = $getNodeByKey(key)
  if (!$isTextNode(node) || node.hasFormat('code') || $findMatchingParent(node, $isCodeNode)) return
  const length = name.length + 2
  if (node.getTextContent().slice(start, start + length) !== `:${name}:` || $afterOpenBacktick(node, start)) return
  const selection = $getSelection()
  const range = $isRangeSelection(selection) ? selection : null
  if (range?.isCollapsed() && range.anchor.key === key && range.anchor.offset === start + length) {
    node.spliceText(start, length, emoji, true)
    return
  }
  node.spliceText(start, length, emoji)
  if (!range) return
  for (const point of [range.anchor, range.focus]) {
    if (point.key === key && point.offset >= start + length) point.set(key, point.offset - (length - emoji.length), 'text')
  }
}

/**
 * Typing the closing colon of a known `:name:` turns it into the emoji. Only typing counts:
 * pasted, synced, undone or composed text keeps its `:smile:`. Like the task shortcut it runs
 * from an update listener, so the typed colon is already in the history and undo gives
 * `:smile:` back. It also starts loading the list at the first colon typed that can open a
 * shortcode; a closing colon typed before the list is there converts when it arrives, if that
 * text is still where it was.
 */
export function registerEmojiShortcut(editor: LexicalEditor): () => void {
  return editor.registerUpdateListener(({ tags, editorState, prevEditorState }) => {
    if (
      tags.has(COLLABORATION_TAG) ||
      tags.has(HISTORIC_TAG) ||
      tags.has(HISTORY_MERGE_TAG) ||
      tags.has(EXTERNAL_TAG) ||
      tags.has(PASTE_TAG) ||
      editor.isComposing()
    ) {
      return
    }
    const typed = editorState.read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== 'text') return null
      const { key, offset } = selection.anchor
      const node = $getNodeByKey(key)
      if (!$isTextNode(node) || node.hasFormat('code') || $findMatchingParent(node, $isCodeNode)) return null
      const text = node.getTextContent()
      // One character inserted at the caret; a caret that only moved right over a colon is not typing.
      const previous = prevEditorState.read(() => {
        // Typing into an empty block creates the text node.
        const was = $getNodeByKey(key)
        if (!was) return ''
        const before = $getSelection()
        return $isRangeSelection(before) && before.isCollapsed() && before.anchor.key === key && before.anchor.offset === offset - 1
          ? was.getTextContent()
          : null
      })
      if (previous !== text.slice(0, offset - 1) + text.slice(offset) || text.charAt(offset - 1) !== ':') return null
      const code = shortcodeBefore(text, offset, 0)
      return code && { ...code, key, inCode: code.closed && $afterOpenBacktick(node, code.start) }
    })
    if (!typed) return
    const index = loadedEmojiIndex()
    if (!index) void loadEmojiIndex()
    if (!typed.closed || typed.inCode) return

    const convert = (known: EmojiIndex): void => {
      const emoji = known.byName.get(typed.name)
      if (emoji === undefined) return
      editor.update(() => $replaceShortcodeAt(typed.key, typed.start, typed.name, emoji), { tag: [HISTORY_PUSH_TAG] })
    }
    if (index) return convert(index)
    void loadEmojiIndex().then((loadedIndex) => {
      if (loadedIndex && !editor.isComposing()) convert(loadedIndex)
    })
  })
}
