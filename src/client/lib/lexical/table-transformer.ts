import { $isLinkNode } from '@lexical/link'
import type { MultilineElementTransformer, Transformer } from '@lexical/markdown'
import { $generateNodesFromMarkdownString } from '@lexical/markdown'
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '@lexical/table'
import { $dfs } from '@lexical/utils'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
  $setState,
  createState,
  type ElementFormatType,
  type ElementNode,
} from 'lexical'
import { $isImageNode } from './nodes/image-node'

const TRIM = /^[ \t\r]+|[ \t\r]+$/g
const DELIMITER_CELL = /^:?-+:?$/

/**
 * Splits a row that starts with `|` into trimmed cells. A backslash protects the
 * next character, so `\|` stays inside its cell (and is still escaped in the
 * result). A trailing `|` closes the last cell instead of opening another one,
 * and a lone `|` has no cells, as in the CodeMirror table model.
 */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let start = 1
  for (let i = 1; i < line.length; i++) {
    if (line[i] === '\\') i++
    else if (line[i] === '|') {
      cells.push(line.slice(start, i))
      start = i + 1
    }
  }
  const last = line.slice(start)
  if (last.replace(TRIM, '') !== '') cells.push(last)
  return cells.map((cell) => cell.replace(TRIM, ''))
}

/**
 * `| --- | :-: |`: every cell has at least one dash. The optional trailing `|`
 * follows GFM, not `isTableRowDivider`, which also accepts empty cells. A tab
 * anywhere makes marked read the pair as text, so it does here.
 */
function readDelimiter(line: string): string[] | null {
  if (!line.startsWith('|') || line.includes('\t')) return null
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell)) ? cells : null
}

/**
 * Whether `header` and `delimiter` (the line after it) open a table: both
 * start with `|` and have the same number of cells. Export uses the same test
 * to decide which paragraph lines need a `\` in front of the `|`.
 */
export function isTableStart(header: string, delimiter: string | undefined): boolean {
  if (delimiter === undefined || !header.startsWith('|')) return false
  const cells = readDelimiter(delimiter)
  return cells !== null && splitRow(header).length === cells.length
}

/**
 * The header row of an imported table was empty and body rows follow, so every
 * row is a body row and the export writes the empty header row back. The
 * CodeMirror table model draws such a table the same way (`headerless`).
 */
export const tableHeaderlessState = createState('keptTableHeaderless', { parse: (value) => value === true })

const ALIGNMENTS: Record<string, ElementFormatType> = { ':-': 'left', '-:': 'right', ':-:': 'center' }
const alignmentOf = (cell: string): ElementFormatType =>
  ALIGNMENTS[`${cell.startsWith(':') ? ':' : ''}-${cell.endsWith(':') ? ':' : ''}`] ?? ''
const DELIMITERS: Partial<Record<ElementFormatType, string>> = { left: ':---', right: '---:', center: ':---:' }

// `\|` is the only escape a cell needs; an escaped backslash must not hide the pipe after it.
const unescapePipes = (cell: string): string => cell.replace(/\\([\s\S])/g, (match, char: string) => (char === '|' ? '|' : match))
const escapePipes = (markdown: string): string => markdown.replace(/\\[\s\S]|\|/g, (match) => (match === '|' ? '\\|' : match))

// What the cell scan looks at: an escaped `<` that starts `<br>`, any other backslash
// pair, or a code span. Only the first is changed.
const CELL_UNITS = /\\<(?=br\s*\/?>)|\\[\s\S]|(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g
const BREAK = /<br\s*\/?>/i

/**
 * Reads the text of a cell into a paragraph. The importer keeps `<br>` as text,
 * which is split into `LineBreakNode`s afterwards, except where a backslash
 * escaped it: the importer unescapes `\<br>` into the same text, so the `<` of
 * an escaped one goes through the importer as a punctuation character (one that
 * the cell does not contain) and is turned back into `<` after the split. A
 * code span keeps `<br>` as text, as in the CodeMirror table model.
 */
function $readCell(text: string, inline: Transformer[]): ElementNode {
  // A punctuation character, so that emphasis next to it is read as it is next to `<`.
  let code = 0x2020
  while (text.includes(String.fromCodePoint(code))) code++
  const mark = String.fromCodePoint(code)
  const marked = text.replace(CELL_UNITS, (unit) => (unit === '\\<' ? mark : unit))
  const paragraph = $generateNodesFromMarkdownString(marked, inline, true, false)[0] as ElementNode
  const unmark = <T extends string | null>(value: T): T => (value === null ? value : (value.split(mark).join('<') as T))
  // Destinations, titles and alt text are not text nodes; the importer unescaped them as well.
  for (const { node } of $dfs(paragraph)) {
    if ($isLinkNode(node)) node.setURL(unmark(node.getURL())).setTitle(unmark(node.getTitle()))
    else if ($isImageNode(node)) node.setSrc(unmark(node.getSrc())).setAlt(unmark(node.getAlt())).setTitle(unmark(node.getTitle()))
  }
  for (const node of paragraph.getAllTextNodes()) {
    const content = node.getTextContent()
    const parts = (node.hasFormat('code') ? [content] : content.split(BREAK)).map((part) => part.split(mark).join('<'))
    if (parts.length === 1) {
      node.setTextContent(parts[0]!)
      continue
    }
    node.getParentOrThrow().splice(
      node.getIndexWithinParent(),
      1,
      parts.flatMap((part, index) => [
        ...(index > 0 ? [$createLineBreakNode()] : []),
        ...(part === '' ? [] : [$createTextNode(part).setFormat(node.getFormat()).setStyle(node.getStyle())]),
      ]),
    )
  }
  return paragraph
}

/** The table as markdown lines: header row, delimiter row, body rows. */
export function exportTable(node: TableNode, exportChildren: (node: ElementNode) => string): string {
  const rows = node.getChildren().filter($isTableRowNode).map((row) => row.getChildren().filter($isTableCellNode))
  const columns = Math.max(0, ...rows.map((row) => row.length))
  if (columns === 0) return ''
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  // A first row without header cells is a body row; reading it as the header would restyle it on reload.
  const headerless = !rows[0]!.some((cell) => cell.hasHeaderState(TableCellHeaderStates.ROW))
  const lines = rows.map((row) =>
    line(
      Array.from({ length: columns }, (_, column) => {
        const blocks = row[column]?.getChildren() ?? []
        const markdown = blocks.map((block) => ($isElementNode(block) ? exportChildren(block) : block.getTextContent())).join('<br>')
        // Cell text is trimmed on import, so leading and trailing spaces cannot be kept.
        return escapePipes(markdown.replace(/\n/g, '<br>')).replace(TRIM, '')
      }),
    ),
  )
  const delimiter = Array.from({ length: columns }, (_, column) => DELIMITERS[rows[0]![column]?.getFormatType() ?? ''] ?? '---')
  if (headerless) lines.unshift(line(Array.from({ length: columns }, () => '')))
  lines.splice(1, 0, line(delimiter))
  return lines.join('\n')
}

/**
 * A GFM table whose rows start with `|`. `inlineTransformers` reads the text of
 * a cell (cells hold inline markup only, so no block transformer may apply).
 *
 * Import: a header row, a delimiter row, then rows until the first line that
 * does not start with `|`. A short row is padded to the delimiter's column
 * count and extra cells are dropped. Row 0 is the header row, unless every
 * header cell is empty and body rows follow (then all rows are body rows and
 * the table is marked headerless); alignment is kept on the cells. `<br>` in a
 * cell is a line break.
 *
 * Export: `| a | b |`, delimiter `---` / `:---` / `---:` / `:---:` from the
 * alignment of row 0, an empty header row first when row 0 is not a header row,
 * `|` in a cell written as `\|`, a line break or a second paragraph in a cell
 * as `<br>`.
 */
export function createTableTransformer(inlineTransformers: () => Transformer[]): MultilineElementTransformer {
  return {
    dependencies: [TableNode, TableRowNode, TableCellNode],
    export: (node, exportChildren) => ($isTableNode(node) ? exportTable(node, exportChildren) : null),
    handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
      const header = lines[startLineIndex]!
      if (!isTableStart(header, lines[startLineIndex + 1])) return null
      const alignments = readDelimiter(lines[startLineIndex + 1]!)!.map(alignmentOf)

      const inline = inlineTransformers().filter(({ type }) => type === 'text-format' || type === 'text-match')
      const $row = (line: string, isHeader: boolean) => {
        const cells = splitRow(line)
        return $createTableRowNode().append(
          ...alignments.map((alignment, column) => {
            const text = unescapePipes(cells[column] ?? '')
            const cell = $createTableCellNode(isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS)
            return cell.setFormat(alignment).append(text === '' ? $createParagraphNode() : $readCell(text, inline))
          }),
        )
      }

      let last = startLineIndex + 1
      while (last + 1 < lines.length && lines[last + 1]!.startsWith('|')) last++
      // An empty header row is what `addEmptyHeaders` writes for a table without one; with
      // no body row it stays, so that the table has a row to click into.
      const headerless = last > startLineIndex + 1 && splitRow(header).every((cell) => cell === '')
      const table = $createTableNode().append(...(headerless ? [] : [$row(header, true)]))
      for (let index = startLineIndex + 2; index <= last; index++) table.append($row(lines[index]!, false))
      if (headerless) $setState(table, tableHeaderlessState, true)
      rootNode.append(table)
      return [true, last]
    },
    regExpStart: /^\|/,
    replace: () => false,
    type: 'multiline-element',
  }
}
