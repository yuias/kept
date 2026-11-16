import { $isCodeNode } from '@lexical/code-core'
import { $createHorizontalRuleNode, $isHorizontalRuleNode, HorizontalRuleNode } from '@lexical/extension'
import { $isAutoLinkNode, $isLinkNode } from '@lexical/link'
import { $isListNode } from '@lexical/list'
import {
  CHECK_LIST,
  CODE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  UNORDERED_LIST,
  type ElementTransformer,
  type MultilineElementTransformer,
  type TextMatchTransformer,
} from '@lexical/markdown'
import {
  $getState,
  $isParagraphNode,
  $isRootNode,
  $isTextNode,
  $setState,
  createState,
  IS_CODE,
  ParagraphNode,
  type LexicalNode,
} from 'lexical'
import { CARD_LINE_PATTERN, cardMarkup, parseCardLine } from '../../../shared/link-card'
import { escapeLineStart, THEMATIC_BREAK } from './escape'
import { $createCardNode, $isCardNode, CardNode } from './nodes/card-node'
import { $createImageNode, $isImageNode, ImageNode } from './nodes/image-node'
import { isTableStart } from './table-transformer'

// Never matches: the transformer exists only to post-process what a paragraph
// exports, so a paragraph must not be imported through it.
const NEVER = /(?!)/

/**
 * Escapes the lines of a root paragraph that would reload as another block. A
 * line that starts with `|` is escaped only where the importer would read it as
 * the header of a table: it is followed by a delimiter row in the same
 * paragraph or the next one. Any other `|` line keeps its bytes. A paragraph
 * next to a table is not checked here: the block seam rule separates the two
 * with a blank line instead.
 */
export const PARAGRAPH_LINE_START: ElementTransformer = {
  dependencies: [ParagraphNode],
  export: (node, exportChildren) => {
    if (!$isParagraphNode(node)) return null
    const lines = exportChildren(node).split('\n')
    const next = node.getNextSibling()
    const nextLine = (index: number): string | undefined =>
      index + 1 < lines.length ? lines[index + 1] : $isParagraphNode(next) ? exportChildren(next).split('\n')[0] : undefined
    return lines
      .map((line, index) => {
        const tableRow = line.startsWith('|') && isTableStart(line, nextLine(index))
        return escapeLineStart(line, { thematicBreak: true, tableRow })
      })
      .join('\n')
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

/**
 * A line that is only `@[card](url)` with an http(s) url, at the root, becomes a
 * card (the rule is the app's own `parseCardLine`). Any other line stays text.
 * Trailing spaces are not kept.
 */
export const CARD: ElementTransformer = {
  dependencies: [CardNode],
  export: (node) => ($isCardNode(node) ? cardMarkup(node.getURL()) : null),
  regExp: CARD_LINE_PATTERN,
  replace: (parentNode, children, match, isImport) => {
    const url = parseCardLine(match[0]!)
    if (url !== null && $isRootNode(parentNode.getParent())) {
      parentNode.replace($createCardNode(url))
      return
    }
    // The importer has already cut the matched prefix off the line's text node;
    // put the whole line back so that the text transformers see the original.
    // The shortcut path hands over the nodes after the caret, which stay as they are.
    // `match` is a RegExpMatchArray on import, although the type says string[].
    const line = children[0]
    if (isImport && $isTextNode(line)) line.setTextContent((match as RegExpMatchArray).input!)
    return false
  },
  type: 'element',
}

/**
 * A thematic break line is a rule, and every spelling is written back as
 * `---`. Must come before the list transformers, which read `- - -` and
 * `* * *` as list items.
 */
export const RULE: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '---' : null),
  regExp: THEMATIC_BREAK,
  replace: (parentNode, _children, _match, isImport) => {
    const rule = $createHorizontalRuleNode()
    // A shortcut at the end of the document keeps the paragraph below the rule
    // for the caret; an import has no caret.
    if (isImport || parentNode.getNextSibling() !== null) parentNode.replace(rule)
    else parentNode.insertBefore(rule)
    if (!isImport) rule.selectNext()
  },
  type: 'element',
}

// Only spaces and tabs indent a list item. The stock patterns read any `\s` before
// the marker, so a line that starts with U+3000 became a list item although GFM
// reads a paragraph. Capture groups stay as in the stock patterns.
export const KEPT_UNORDERED_LIST: ElementTransformer = { ...UNORDERED_LIST, regExp: /^([ \t]*)[-*+]\s/ }
export const KEPT_CHECK_LIST: ElementTransformer = { ...CHECK_LIST, regExp: /^([ \t]*)(?:[-*+]\s)?\s?(\[(\s|x)?\])\s/i }
// `1)` is an ordered item in GFM too. It is written back as `1.`.
export const KEPT_ORDERED_LIST: ElementTransformer = { ...ORDERED_LIST, regExp: /^([ \t]*)(\d{1,})[.)]\s/ }

/**
 * `>x` without a space is a quote in GFM. Import reads it; the export writes
 * `> x`. The shortcut still needs the space, so that Enter after a lone `>`
 * does not open a quote.
 */
export const KEPT_QUOTE: ElementTransformer = {
  ...QUOTE,
  regExp: /^>\s?/,
  replace: (parentNode, children, match, isImport) =>
    isImport || /\s$/.test(match[0]!) ? QUOTE.replace(parentNode, children, match, isImport) : false,
}

// Group 1 is the fence line's leading whitespace plus the fence, as in the
// stock `CODE` transformer, which the callers of this one read.
const FENCE_START = /^([ \t]*(?:`{3,}|~{3,}))([\w-]+)?[ \t]?/

/**
 * The stock importer, then the empty lines right before the closing fence put
 * back into the code: the stock `replace` drops them, which changes the bytes
 * of the block. A block with no other content loses one line less, because the
 * lines are the separators between its empty lines.
 */
const importCode: NonNullable<MultilineElementTransformer['handleImportAfterStartMatch']> = (args) => {
  const { lines, rootNode, startLineIndex, startMatch } = args
  const result = CODE.handleImportAfterStartMatch!(args)
  const end = result?.[1] ?? -1
  const closer = new RegExp(`^[ \\t]*\`{${startMatch[1]!.trim().length},}$`)
  const code = rootNode.getLastChild()
  const text = $isCodeNode(code) ? code.getFirstChild() : null
  if (end <= startLineIndex || !closer.test(lines[end]!) || !$isTextNode(text)) return result
  let empty = 0
  while (empty < end - startLineIndex - 1 && lines[end - 1 - empty] === '') empty++
  if (empty > 0) text.setTextContent(text.getTextContent() + '\n'.repeat(text.getTextContent() === '' ? empty - 1 : empty))
  return result
}

/**
 * The stock `CODE` transformer, plus `~~~` fences. A tilde fence is imported
 * as the backtick fence the stock importer reads (written back as ```` ``` ````),
 * so the block runs to the first closing tilde fence at least as long as the
 * opening one, and backtick lines inside it stay content.
 */
export const FENCED_CODE: MultilineElementTransformer = {
  ...CODE,
  handleImportAfterStartMatch: (args) => {
    const { lines, startLineIndex, startMatch } = args
    const opening = startMatch[1]!.trim()
    if (!opening.startsWith('~')) return importCode(args)

    const indent = startMatch[1]!.slice(0, startMatch[1]!.length - opening.length)
    const closing = new RegExp(`^[ \\t]*~{${opening.length},}[ \\t]*$`)
    const closingIndex = lines.findIndex((line, i) => i > startLineIndex && closing.test(line))
    const last = closingIndex === -1 ? lines.length - 1 : closingIndex
    // A fence longer than any backtick run in the block cannot be closed from inside it.
    const longestRun = Math.max(0, ...lines.slice(startLineIndex, last + 1).flatMap((line) => (line.match(/`+/g) ?? []).map((run) => run.length)))
    const fence = '`'.repeat(Math.max(3, longestRun + 1))

    const rewritten = [...lines]
    rewritten[startLineIndex] = indent + fence + lines[startLineIndex]!.slice(indent.length + opening.length)
    if (closingIndex !== -1) rewritten[closingIndex] = indent + fence
    return importCode({ ...args, lines: rewritten, startMatch: rewritten[startLineIndex]!.match(FENCE_START)! })
  },
  regExpStart: FENCE_START,
}

/** Leading whitespace of the fence line of a code block that was loaded right after a list. */
export const fenceIndentState = createState('keptFenceIndent', {
  parse: (value) => (typeof value === 'string' && /^[ \t]*$/.test(value) ? value : ''),
})

// Lines that sit between a list and its fence without ending the list item: empty
// or whitespace-only lines, and text indented at least as far as the fence.
const $previousNonEmpty = (node: LexicalNode, indent: string): LexicalNode | null => {
  let previous = node.getPreviousSibling()
  while ($isParagraphNode(previous)) {
    const text = previous.getTextContent()
    if (text.trim() !== '' && /^[ \t]*/.exec(text)![0].length < indent.length) break
    previous = previous.getPreviousSibling()
  }
  return previous
}

/**
 * Import puts a fence inside a list item at the root after the list, and export
 * flattens list items, so the indent would be lost. The fence's indent is kept
 * in the node and written back in front of every non-empty line, but only while
 * the block still follows a list: anywhere else an indent would turn it into an
 * indented code block or lazy paragraph text.
 */
export const INDENTED_CODE: MultilineElementTransformer = {
  ...FENCED_CODE,
  handleImportAfterStartMatch: (args) => {
    const handled = FENCED_CODE.handleImportAfterStartMatch!(args)
    const code = args.rootNode.getLastChild()
    const indent = /^[ \t]*/.exec(args.startMatch[1]!)![0]
    if (handled && indent && $isCodeNode(code) && $isListNode($previousNonEmpty(code, indent))) $setState(code, fenceIndentState, indent)
    return handled
  },
  export: (node, ...rest) => {
    const out = FENCED_CODE.export!(node, ...rest)
    if (out === null || !$isCodeNode(node)) return out
    const indent = $getState(node, fenceIndentState)
    if (!indent || !$isListNode($previousNonEmpty(node, indent))) return out
    return out.split('\n').map((line) => (line ? indent + line : line)).join('\n')
  },
}
