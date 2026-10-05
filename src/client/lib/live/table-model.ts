import { syntaxTree } from '@codemirror/language'
import type { EditorState, Text } from '@codemirror/state'

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

/** Inline content of a TableCell node. */
export function readInline(doc: Text, cell: SyntaxNode): InlineSpan[] {
  const text = doc.sliceString(cell.from, cell.to)
  return text === '' ? [] : [{ kind: 'text', text }]
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
