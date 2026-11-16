import { buildEditorFromExtensions } from '@lexical/extension'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CODE,
  HIGHLIGHT,
  LINK,
  ORDERED_LIST,
  QUOTE,
  setPlainTextEscaper,
  TRANSFORMERS as STOCK_TRANSFORMERS,
  UNORDERED_LIST,
  type Transformer,
} from '@lexical/markdown'
import { $isAutoLinkNode, $isLinkNode } from '@lexical/link'
import { $isListItemNode, $isListNode, type ListNode } from '@lexical/list'
import { $isTableCellNode, $isTableNode } from '@lexical/table'
import { marked } from 'marked'
import {
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  defineExtension,
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  type ElementNode,
  type LexicalEditorWithDispose,
  type LexicalNode,
  type TextNode,
} from 'lexical'
import { type Edge, escapeLineStart, escapePlainText } from './escape'
import { MarkdownNodesExtension } from './extension'
import { $isCardNode } from './nodes/card-node'
import { createTableTransformer, isTableStart } from './table-transformer'
import {
  CARD,
  CODE_SPAN,
  IMAGE,
  INDENTED_CODE,
  KEPT_CHECK_LIST,
  KEPT_LINK,
  KEPT_ORDERED_LIST,
  KEPT_QUOTE,
  KEPT_UNORDERED_LIST,
  PARAGRAPH_LINE_START,
  RULE,
} from './transformers'

// Cells hold inline markup only, so the table reads them with the inline transformers.
const TABLE = createTableTransformer(() => TRANSFORMERS)

// Highlight (`==x==`) cannot be stored in markdown that GitHub-style readers
// understand, so it stays plain text.
export const TRANSFORMERS: Transformer[] = [
  ...STOCK_TRANSFORMERS.filter((transformer) => transformer !== HIGHLIGHT).flatMap((transformer) => {
    if (transformer === LINK) return [IMAGE, KEPT_LINK]
    // The rule and the check list read lines the list transformers would take.
    if (transformer === UNORDERED_LIST) return [RULE, KEPT_CHECK_LIST, KEPT_UNORDERED_LIST]
    if (transformer === ORDERED_LIST) return [KEPT_ORDERED_LIST]
    if (transformer === QUOTE) return [KEPT_QUOTE]
    return transformer === CODE ? [INDENTED_CODE, TABLE] : [transformer]
  }),
  CARD,
  CODE_SPAN,
  PARAGRAPH_LINE_START,
]

// Characters the exporter writes around text with these formats. Underline and
// the like have no markdown spelling and write nothing.
const delimiterOf = (format: number): string =>
  (format & (IS_BOLD | IS_ITALIC) ? '*' : '') + (format & IS_STRIKETHROUGH ? '~' : '') + (format & IS_CODE ? '`' : '')

// What the exporter writes next to a text node: the adjacent character of a
// plain neighbour, a newline for a line break, nothing at a block edge, and the
// delimiter characters of formatted text, code and links.
function edge(sibling: LexicalNode | null, last: boolean): Edge {
  if (!sibling) return ''
  if ($isLineBreakNode(sibling)) return '\n'
  const delimiter = $isTextNode(sibling) ? delimiterOf(sibling.getFormat()) : $isLinkNode(sibling) && !$isAutoLinkNode(sibling) ? (last ? ')' : '[') : ''
  if (delimiter) return { delimiter }
  return (last ? /.$/su : /^./su).exec(sibling.getTextContent())?.[0] ?? ''
}

// In a cell, `<br>` does not end inline markup: `*a`, a break and `b*` read as one
// emphasis. For a plain text node that touches a break (or sits in a cell with
// several paragraphs), this is the joined text of the plain run around it, the
// node's offset in it, and what the exporter writes beyond the run.
function breakRun(node: TextNode): { text: string; start: number; before: Edge; after: Edge } | null {
  const cell = node.getParents().find($isTableCellNode)
  if (!cell) return null
  // `null` stands for the `<br>` the table writes between two paragraphs.
  const items = cell.getChildren().flatMap((block, index) => [...(index ? [null] : []), ...($isElementNode(block) ? block.getChildren() : [block])])
  const at = items.indexOf(node)
  const plain = (item: LexicalNode | null) => item === null || $isLineBreakNode(item) || ($isTextNode(item) && item.getFormat() === 0)
  let first = at
  let last = at
  while (first > 0 && plain(items[first - 1]!)) first--
  while (last < items.length - 1 && plain(items[last + 1]!)) last++
  if (at < 0 || first === last) return null
  const part = (item: LexicalNode | null) => (item === null || $isLineBreakNode(item) ? '<br>' : item.getTextContent())
  return {
    text: items.slice(first, last + 1).map(part).join(''),
    start: items.slice(first, at).map(part).join('').length,
    before: first > 0 ? edge(items[first - 1]!, true) : '',
    after: last < items.length - 1 ? edge(items[last + 1]!, false) : '',
  }
}

const isBulletItem = (node: LexicalNode | null): boolean =>
  $isListItemNode(node) && $isListNode(node.getParent()) && (node.getParent() as ListNode).getListType() === 'bullet'

// The stock exporter escapes every `*_`~` in preserve-newlines mode; this
// escapes only what the importer would read as markup (see escape.ts). A
// formatted node is wrapped in delimiters itself, so both its edges are
// delimiter edges.
setPlainTextEscaper((text, node) => {
  const own = delimiterOf(node.getFormat())
  const run = own ? null : breakRun(node)
  let escaped = own
    ? escapePlainText(text, { delimiter: own }, { delimiter: own }, true)
    : run
      ? escapePlainText(run.text, run.before, run.after, true, [run.start, run.start + text.length])
      : escapePlainText(text, edge(node.getPreviousSibling(), true), edge(node.getNextSibling(), false), true)
  // CHECK_LIST reads `- [ ] x` and `[ ] x` alike, so a bullet item whose text starts
  // with `[ ]` would reload as a task. The `[` is the only character to escape.
  if (!own && !node.getPreviousSibling() && isBulletItem(node.getParent())) {
    const next = edge(node.getNextSibling(), false)
    const head = /^\s?\[(?:\s|x)?\]\s/i.exec(escaped + (typeof next === 'string' ? next : ''))
    if (head) {
      const at = head[0].indexOf('[')
      escaped = `${escaped.slice(0, at)}\\${escaped.slice(at)}`
    }
  }
  // GFM reads `- - x` as a nested list and `- > x` as a quote, while the importer keeps the
  // rest of the line as text. Escaping makes both agree. The stock `1\. ` escape of
  // bullet items is left to this code too: it no longer matches the escaped text.
  if (!own && !node.getPreviousSibling() && $isListItemNode(node.getParent())) {
    const next = edge(node.getNextSibling(), false)
    const tail = typeof next === 'string' ? next : ''
    const line = escapeLineStart(escaped + tail, { thematicBreak: true, tableRow: false, listItem: true })
    escaped = line.slice(0, line.length - tail.length)
  }
  // The table reads `<br>` in a cell as a line break, so typed `<br>` text needs its `<` escaped.
  if (/<br/i.test(escaped) && node.getParents().some($isTableCellNode)) escaped = escaped.replace(/<(?=br\s*\/?>)/gi, '\\<')
  // A `!` right before a link would join it into `![label](url)`. Only an
  // escape the importer would otherwise read as an image is worth the byte
  // change: links that IMAGE does not match (`<url>`, parentheses) keep `!`.
  // The link is tested as the exporter writes it, not as its raw URL.
  const next = node.getNextSibling()
  if (!own && $isLinkNode(next) && !$isAutoLinkNode(next) && escaped.endsWith('!')) {
    const link = KEPT_LINK.export!(next, (parent) => parent.getTextContent(), (_text, content) => content)
    if (link !== null && IMAGE.importRegExp!.exec(`!${link}`)?.index === 0) return `${escaped.slice(0, -1)}\\!`
  }
  return escaped
})

// shouldPreserveNewLines keeps each source line as its own paragraph, so Enter in
// the editor writes a single "\n" and untouched text keeps its line structure.
export function $importMarkdown(markdown: string, transformers: Transformer[] = TRANSFORMERS): void {
  $convertFromMarkdownString(markdown, transformers, undefined, true, false)
}

/** `${a.getKey()}|${b.getKey()}` for every pair of adjacent root children. */
export function $rootSeams(): Set<string> {
  const children = $getRoot().getChildren()
  return new Set(children.slice(1).map((child, index) => `${children[index]!.getKey()}|${child.getKey()}`))
}

// `createMarkdownExport` only calls `getChildren()` on the node it is given, so a
// stand-in container exports one root child at a time.
const $exportBlock = (child: LexicalNode, transformers: Transformer[]): string =>
  $convertToMarkdownString(transformers, { getChildren: () => [child] } as unknown as ElementNode, true)

const blockTypes = (markdown: string): string[] => marked.lexer(markdown).map((token) => token.type).filter((type) => type !== 'space')
// True when a single newline between the two blocks makes GFM read them differently.
const joins = (a: string, b: string): boolean => blockTypes(`${a}\n${b}`).join() !== [...blockTypes(a), ...blockTypes(b)].join()

// Enter writes a single newline and the app reads card lines one by one, so two
// paragraph-like blocks are never separated by a blank line.
const isParagraphLike = (node: LexicalNode): boolean => $isParagraphNode(node) || $isCardNode(node)

/**
 * The stock export, one root child at a time. Two adjacent blocks that GFM would
 * read as something else when joined by one newline (`a` + `---` is a heading,
 * `x` after a table is a row) get a blank line instead. `loadedSeams` lists the
 * pairs that were adjacent when the note was loaded: their bytes came from the
 * source and stay as they are.
 */
export function $exportMarkdown(transformers: Transformer[] = TRANSFORMERS, loadedSeams: ReadonlySet<string> = new Set()): string {
  const children = $getRoot().getChildren()
  const pieces = children.map((child) => $exportBlock(child, transformers))
  return pieces.reduce((out, piece, index) => {
    if (index === 0) return piece
    const a = children[index - 1]!
    const b = children[index]!
    const previous = pieces[index - 1]!
    // The importer reads a `|` line after a table as a row, and a paragraph line
    // before a delimiter row as a header. Editing a loaded neighbour into one of
    // these must not be covered by the exemption.
    const readAsTable =
      ($isTableNode(a) && piece.startsWith('|')) ||
      ($isTableNode(b) && $isParagraphNode(a) && isTableStart(previous.slice(previous.lastIndexOf('\n') + 1), piece.split('\n')[0]))
    const blank =
      previous !== '' &&
      piece !== '' &&
      (readAsTable || (!loadedSeams.has(`${a.getKey()}|${b.getKey()}`) && !(isParagraphLike(a) && isParagraphLike(b)) && joins(previous, piece)))
    return out + (blank ? '\n\n' : '\n') + piece
  }, '')
}

export function createMarkdownEditor(): LexicalEditorWithDispose {
  return buildEditorFromExtensions(
    defineExtension({
      name: 'kept/markdown-editor',
      dependencies: [MarkdownNodesExtension],
      // Lexical logs and swallows errors by default; tests and the fidelity guard need them thrown.
      onError: (error) => {
        throw error
      },
    }),
  )
}

export function roundTrip(markdown: string, transformers: Transformer[] = TRANSFORMERS): string {
  const editor = createMarkdownEditor()
  editor.update(() => $importMarkdown(markdown, transformers), { discrete: true })
  const loadedSeams = editor.read($rootSeams)
  const exported = editor.read(() => $exportMarkdown(transformers, loadedSeams))
  editor.dispose()
  return exported
}
