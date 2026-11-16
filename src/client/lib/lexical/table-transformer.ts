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
import { $createParagraphNode, $isElementNode, type ElementFormatType, type ElementNode } from 'lexical'

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

const ALIGNMENTS: Record<string, ElementFormatType> = { ':-': 'left', '-:': 'right', ':-:': 'center' }
const alignmentOf = (cell: string): ElementFormatType =>
  ALIGNMENTS[`${cell.startsWith(':') ? ':' : ''}-${cell.endsWith(':') ? ':' : ''}`] ?? ''
const DELIMITERS: Partial<Record<ElementFormatType, string>> = { left: ':---', right: '---:', center: ':---:' }

// `\|` is the only escape a cell needs; an escaped backslash must not hide the pipe after it.
const unescapePipes = (cell: string): string => cell.replace(/\\([\s\S])/g, (match, char: string) => (char === '|' ? '|' : match))
const escapePipes = (markdown: string): string => markdown.replace(/\\[\s\S]|\|/g, (match) => (match === '|' ? '\\|' : match))

/** The table as markdown lines: header row, delimiter row, body rows. */
export function exportTable(node: TableNode, exportChildren: (node: ElementNode) => string): string {
  const rows = node.getChildren().filter($isTableRowNode).map((row) => row.getChildren().filter($isTableCellNode))
  const columns = Math.max(0, ...rows.map((row) => row.length))
  if (columns === 0) return ''
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
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
  lines.splice(1, 0, line(delimiter))
  return lines.join('\n')
}

/**
 * A GFM table whose rows start with `|`. `inlineTransformers` reads the text of
 * a cell (cells hold inline markup only, so no block transformer may apply).
 *
 * Import: a header row, a delimiter row, then rows until the first line that
 * does not start with `|`. A short row is padded to the delimiter's column
 * count and extra cells are dropped. Row 0 is the header row; alignment is
 * kept on the cells.
 *
 * Export: `| a | b |`, delimiter `---` / `:---` / `---:` / `:---:` from the
 * alignment of row 0, `|` in a cell written as `\|`, a line break or a second
 * paragraph in a cell as `<br>`.
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
            const paragraph = text === '' ? $createParagraphNode() : $generateNodesFromMarkdownString(text, inline, true, false)[0]!
            const cell = $createTableCellNode(isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS)
            return cell.setFormat(alignment).append(paragraph)
          }),
        )
      }

      const table = $createTableNode().append($row(header, true))
      let last = startLineIndex + 1
      while (last + 1 < lines.length && lines[last + 1]!.startsWith('|')) table.append($row(lines[++last]!, false))
      rootNode.append(table)
      return [true, last]
    },
    regExpStart: /^\|/,
    replace: () => false,
    type: 'multiline-element',
  }
}
