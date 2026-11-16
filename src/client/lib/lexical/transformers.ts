import { $isAutoLinkNode, $isLinkNode } from '@lexical/link'
import { LINK, type ElementTransformer, type TextMatchTransformer } from '@lexical/markdown'
import { $isParagraphNode, $isTextNode, IS_CODE, ParagraphNode } from 'lexical'
import { escapeLineStart, type LineStartBlocks } from './escape'
import { $createImageNode, $isImageNode, ImageNode } from './nodes/image-node'

// Thematic breaks and table rows are plain paragraphs until the RULE and TABLE
// transformers exist; escaping them now would change the bytes of notes that
// load and export unchanged. Switch each flag on together with its transformer.
const LINE_START_BLOCKS: LineStartBlocks = { thematicBreak: false, tableRow: false }

// Never matches: the transformer exists only to post-process what a paragraph
// exports, so a paragraph must not be imported through it.
const NEVER = /(?!)/

/** Escapes the lines of a root paragraph that would reload as another block. */
export const PARAGRAPH_LINE_START: ElementTransformer = {
  dependencies: [ParagraphNode],
  export: (node, exportChildren) => {
    if (!$isParagraphNode(node)) return null
    return exportChildren(node).split('\n').map((line) => escapeLineStart(line, LINE_START_BLOCKS)).join('\n')
  },
  regExp: NEVER,
  replace: () => false,
  type: 'element',
}

/**
 * Writes plain inline code. The stock export pads the content with a space on
 * both sides whenever it contains a backtick and fences it with a run longer
 * than any inside, which changes the bytes of `` ``a ` b`` ``. Here the fence is
 * the shortest run length the content does not contain (a longer run could
 * start a fenced block at the start of a line), and padding is only used where
 * CommonMark would otherwise drop or merge characters: a backtick at either
 * end, or whitespace at both ends of content that is not all whitespace.
 * Nodes that carry other formats still go through the stock export.
 */
export const CODE_SPAN: TextMatchTransformer = {
  dependencies: [],
  export: (node) => {
    if (!$isTextNode(node) || node.getFormat() !== IS_CODE) return null
    const content = node.getTextContent()
    const used = new Set((content.match(/`+/g) ?? []).map((run) => run.length))
    let length = 1
    while (used.has(length)) length++
    const fence = '`'.repeat(length)
    const padded = content === '' || /^`|`$/.test(content) || (/^\s/.test(content) && /\s$/.test(content) && /\S/.test(content))
    return padded ? `${fence} ${content} ${fence}` : fence + content + fence
  },
  regExp: NEVER,
  type: 'text-match',
}

// Destinations and titles follow LINK, minus the forms that cannot be kept in
// one field: a destination with parentheses, or in `<>` with anything but
// plain characters, is left to LINK. A plain `<b>` is read as `b` (the link
// export drops the brackets the same way), and a title in `'` or `()` is read
// and written back with `"`.
const IMAGE_SYNTAX =
  /!\[([^\]\n]*)\]\(\s*(?:<([^\s<>()\\]*)>|((?!<)(?:\\\S|\\(?=\s)|[^\s()\\])*))(?:\s+(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|\(((?:[^()\\\n]|\\.)*)\)))?\s*\)/

// A title is kept as written between the quotes; only the quote of the
// spelling it is written back with must not end it early.
const quoteTitle = (raw: string): string => raw.replace(/\\.|"/g, (part) => (part === '"' ? '\\"' : part))

// The text-match importer does not skip an escaped `!` (only LINK checks its own
// start), and `\![a](b)` is a literal `!` followed by a link.
const isEscaped = (source: string, index: number): boolean => /(?:^|[^\\])(?:\\\\)*\\$/.test(source.slice(0, index))

/**
 * `![alt](src "title")`, whatever the target. Whether an `<img>` is rendered is
 * the view's decision; the node keeps the source so that export is byte-exact
 * (whitespace inside the parentheses and `'`/`()` titles are written back
 * as `![alt](src "title")`).
 * Must come before LINK, which also matches the `[alt](src)` part.
 */
export const IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: (node) => ($isImageNode(node) ? node.getTextContent() : null),
  // An escaped `!` is declined here so that LINK gets the same text.
  getEndIndex: (_node, match) => (isEscaped(match.input!, match.index!) ? false : match.index! + match[0].length),
  importRegExp: IMAGE_SYNTAX,
  regExp: new RegExp(`${IMAGE_SYNTAX.source}$`),
  replace: (textNode, match) => {
    const [, alt, pointy, raw, doubleQuoted, singleQuoted, parenthesized] = match
    const other = singleQuoted ?? parenthesized
    const title = doubleQuoted ?? (other === undefined ? null : quoteTitle(other))
    textNode.replace($createImageNode(pointy ?? raw!, alt!, title))
  },
  type: 'text-match',
}

const CHARACTER_REFERENCE = /&(?=#\d+;|#[Xx][\dA-Fa-f]+;|[A-Za-z][\dA-Za-z]*;)/

// The importer reads parentheses up to three levels deep (see LINK.importRegExp).
const hasBalancedParentheses = (url: string): boolean => {
  let depth = 0
  for (const char of url) {
    if (char === '(' && ++depth > 3) return false
    if (char === ')' && --depth < 0) return false
  }
  return depth === 0
}

/**
 * The stock link export escapes every parenthesis in the destination, which
 * changes the bytes of `https://en.wikipedia.org/wiki/Foo_(bar)`. A balanced
 * destination without whitespace, `<`, `\` or a character reference reads back
 * the same when raw, so it is written raw; every other link goes through the
 * stock export.
 */
export const KEPT_LINK: TextMatchTransformer = {
  ...LINK,
  export: (node, exportChildren, exportFormat) => {
    const stock = LINK.export!(node, exportChildren, exportFormat)
    if (stock === null || !$isLinkNode(node) || $isAutoLinkNode(node)) return stock
    const url = node.getURL()
    if (url === '' || /[\s<\\]/.test(url) || CHARACTER_REFERENCE.test(url) || !hasBalancedParentheses(url)) return stock
    const head = `[${exportChildren(node)}](`
    const stockUrl = url.replace(/([()])/g, '\\$1')
    return stock.startsWith(head + stockUrl) ? head + url + stock.slice(head.length + stockUrl.length) : stock
  },
}
