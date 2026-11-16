import { buildEditorFromExtensions } from '@lexical/extension'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  CODE,
  HIGHLIGHT,
  LINK,
  setPlainTextEscaper,
  TRANSFORMERS as STOCK_TRANSFORMERS,
  UNORDERED_LIST,
  type Transformer,
} from '@lexical/markdown'
import { $isAutoLinkNode, $isLinkNode } from '@lexical/link'
import { $isListItemNode, $isListNode, type ListNode } from '@lexical/list'
import { $isTableCellNode } from '@lexical/table'
import {
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  defineExtension,
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  type LexicalEditorWithDispose,
  type LexicalNode,
  type TextNode,
} from 'lexical'
import { type Edge, escapePlainText } from './escape'
import { MarkdownNodesExtension } from './extension'
import { createTableTransformer } from './table-transformer'
import { CARD, CODE_SPAN, IMAGE, INDENTED_CODE, KEPT_LINK, PARAGRAPH_LINE_START, RULE } from './transformers'

// Cells hold inline markup only, so the table reads them with the inline transformers.
const TABLE = createTableTransformer(() => TRANSFORMERS)

// Highlight (`==x==`) cannot be stored in markdown that GitHub-style readers
// understand, so it stays plain text.
export const TRANSFORMERS: Transformer[] = [
  ...STOCK_TRANSFORMERS.filter((transformer) => transformer !== HIGHLIGHT).flatMap((transformer) => {
    if (transformer === LINK) return [IMAGE, KEPT_LINK]
    // The rule and the check list read lines the list transformers would take.
    if (transformer === UNORDERED_LIST) return [RULE, CHECK_LIST, transformer]
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

export function $exportMarkdown(transformers: Transformer[] = TRANSFORMERS): string {
  return $convertToMarkdownString(transformers, undefined, true)
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
  const exported = editor.read(() => $exportMarkdown(transformers))
  editor.dispose()
  return exported
}
