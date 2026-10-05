import { syntaxTree } from '@codemirror/language'
import type { EditorState, Text } from '@codemirror/state'
import { linkHref } from './links'

// @lezer/common is not a direct dependency, so the node type is derived.
type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

export type Align = 'left' | 'center' | 'right' | null

export type InlineSpan =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'em' | 'strike'; children: InlineSpan[] }
  | { kind: 'code'; text: string }
  // href null: target not allowed by linkHref; rendered as its children only.
  | { kind: 'link'; href: string | null; children: InlineSpan[] }

/** One cell; an empty cell is []. */
export type TableCell = InlineSpan[]

export interface TableModel {
  align: Align[]
  header: TableCell[]
  rows: TableCell[][]
}

export interface TableBlock {
  from: number
  to: number
  /** Identity key for the widget: `state.doc.sliceString(from, to)`. */
  source: string
  model: TableModel
}

/** Whole-line span of a Table node: first line start to last line end. */
export function tableLineSpan(
  doc: Text,
  node: { from: number; to: number },
): { from: number; to: number; firstLine: number; lastLine: number } {
  // A node ending right after a line break does not own the next line.
  const end = node.to > node.from && doc.lineAt(node.to).from === node.to ? node.to - 1 : node.to
  const first = doc.lineAt(node.from)
  const last = doc.lineAt(end)
  return { from: first.from, to: last.to, firstLine: first.number, lastLine: last.number }
}

/** True when the table is top-level and no selection range touches any of its lines. */
export function isRenderedTable(state: EditorState, active: ReadonlySet<number>, node: SyntaxNode): boolean {
  // Quoted / listed tables carry per-line prefixes that one block widget would drop.
  if (node.parent?.name !== 'Document') return false
  const { firstLine, lastLine } = tableLineSpan(state.doc, node)
  for (let n = firstLine; n <= lastLine; n++) if (active.has(n)) return false
  return true
}

/** Alignment per column from the delimiter row text, e.g. `| :-- | :-: | --: | --- |`. */
export function readAlignments(delimiterRow: string): Align[] {
  let row = delimiterRow.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  return row.split('|').map((segment): Align => {
    const cell = segment.trim()
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right && cell.length > 1) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

function pushText(spans: InlineSpan[], text: string): void {
  if (text === '') return
  const last = spans[spans.length - 1]
  if (last?.kind === 'text') last.text += text
  else spans.push({ kind: 'text', text })
}

function pushSpan(spans: InlineSpan[], span: InlineSpan): void {
  if (span.kind === 'text') pushText(spans, span.text)
  else spans.push(span)
}

function readCode(doc: Text, node: SyntaxNode): InlineSpan {
  const marks = node.getChildren('CodeMark')
  const open = marks[0]
  const close = marks[marks.length - 1]
  if (!open || !close || open === close) return { kind: 'text', text: doc.sliceString(node.from, node.to) }
  // GFM unescapes the pipe inside code spans in a table; lezer does not.
  let text = doc.sliceString(open.to, close.from).replaceAll('\\|', '|')
  if (text.length > 1 && text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') text = text.slice(1, -1)
  return { kind: 'code', text }
}

function readNode(doc: Text, node: SyntaxNode): InlineSpan {
  const raw = (): InlineSpan => ({ kind: 'text', text: doc.sliceString(node.from, node.to) })
  switch (node.name) {
    case 'StrongEmphasis':
      return { kind: 'strong', children: readSpans(doc, node, node.from, node.to) }
    case 'Emphasis':
      return { kind: 'em', children: readSpans(doc, node, node.from, node.to) }
    case 'Strikethrough':
      return { kind: 'strike', children: readSpans(doc, node, node.from, node.to) }
    case 'InlineCode':
      return readCode(doc, node)
    case 'Link': {
      const url = node.getChild('URL')
      const [open, close] = node.getChildren('LinkMark')
      // Reference and shortcut forms need a definition lookup, so they stay source.
      if (!url || !open || !close) return raw()
      return {
        kind: 'link',
        href: linkHref(doc.sliceString(url.from, url.to)),
        children: readSpans(doc, node, open.to, close.from),
      }
    }
    case 'Autolink':
    case 'URL': {
      const url = node.name === 'URL' ? node : node.getChild('URL')
      if (!url) return raw()
      const text = doc.sliceString(url.from, url.to)
      return { kind: 'link', href: linkHref(text), children: [{ kind: 'text', text }] }
    }
    case 'Escape':
      return { kind: 'text', text: doc.sliceString(node.from + 1, node.to) }
    case 'Image': {
      const [open, close] = node.getChildren('LinkMark')
      return open && close ? { kind: 'text', text: doc.sliceString(open.to, close.from) } : raw()
    }
    default:
      return raw()
  }
}

// Reads the children of `node` that lie inside [from, to]; text between them is kept.
function readSpans(doc: Text, node: SyntaxNode, from: number, to: number): InlineSpan[] {
  const spans: InlineSpan[] = []
  let pos = from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from < from || child.to > to) continue
    pushText(spans, doc.sliceString(pos, child.from))
    pos = child.to
    if (child.name === 'EmphasisMark' || child.name === 'StrikethroughMark') continue
    pushSpan(spans, readNode(doc, child))
  }
  pushText(spans, doc.sliceString(pos, to))
  return spans
}

/** Inline content of a TableCell node. */
export function readInline(doc: Text, cell: SyntaxNode): InlineSpan[] {
  return readSpans(doc, cell, cell.from, cell.to)
}

// @lezer/markdown emits no TableCell for an empty cell, only the pipes, so
// columns are counted from the pipes rather than from the cell nodes.
function readRow(doc: Text, row: SyntaxNode, count: number): TableCell[] {
  const cells: TableCell[] = Array.from({ length: count }, () => [])
  let col = 0
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableDelimiter') {
      // A leading pipe opens the first cell instead of closing one.
      if (child.prevSibling) col++
    } else if (child.name === 'TableCell' && col < count) {
      cells[col] = readInline(doc, child)
    }
  }
  return cells
}

/** Builds the model of a Table node. */
export function readTable(doc: Text, table: SyntaxNode): TableModel {
  const delimiter = table.getChild('TableDelimiter')
  const align = readAlignments(delimiter ? doc.sliceString(delimiter.from, delimiter.to) : '')
  const count = align.length
  const header = table.getChild('TableHeader')
  return {
    align,
    header: header ? readRow(doc, header, count) : Array.from({ length: count }, () => []),
    rows: table.getChildren('TableRow').map((row) => readRow(doc, row, count)),
  }
}

/** Every top-level table in the parsed document, in document order. */
export function collectTables(state: EditorState): TableBlock[] {
  const tables: TableBlock[] = []
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== 'Table') continue
    const { from, to } = tableLineSpan(state.doc, node)
    tables.push({ from, to, source: state.doc.sliceString(from, to), model: readTable(state.doc, node) })
  }
  return tables
}
