// Markdown rewrites for the Notion importer. Every "how will kept read this"
// decision uses the parser the live editor uses, so the rewrites cannot change
// what a note renders as. This file runs under plain Node type stripping
// (erasable syntax only) and must not import @lezer/*, which is not a direct
// dependency.

import { markdownLanguage } from '@codemirror/lang-markdown'

type Tree = ReturnType<typeof markdownLanguage.parser.parse>
type SyntaxNode = Tree['topNode']

/** A top-level block: lezer node name and its 0-based first and last line. */
export interface Block {
  name: string
  firstLine: number
  lastLine: number
}

function lineStarts(md: string): number[] {
  const starts = [0]
  for (let i = md.indexOf('\n'); i !== -1; i = md.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

/** Index of the last line start that is <= offset. */
function lineAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Top-level nodes of `md` as parsed by the live editor's parser. */
export function topLevelBlocks(md: string): Block[] {
  const starts = lineStarts(md)
  const blocks: Block[] = []
  for (let node: SyntaxNode | null = markdownLanguage.parser.parse(md).topNode.firstChild; node; node = node.nextSibling) {
    // A node that ends right after a line break does not own the next line.
    const end = node.to > node.from && md[node.to - 1] === '\n' ? node.to - 1 : node.to
    blocks.push({ name: node.name, firstLine: lineAt(starts, node.from), lastLine: lineAt(starts, end) })
  }
  return blocks
}

/** `topLevelBlocks` names with runs of adjacent 'Paragraph' merged into one entry. */
export function blockSignature(md: string): string[] {
  const names: string[] = []
  for (const { name } of topLevelBlocks(md)) {
    if (name === 'Paragraph' && names[names.length - 1] === 'Paragraph') continue
    names.push(name)
  }
  return names
}

/**
 * Unescaped `|` count, using the same rule @lezer/markdown uses to split table
 * rows. Pipes inside code spans count too, because lezer and GFM split cells
 * there as well.
 */
export function countRowPipes(line: string): number {
  let count = 0
  let esc = false
  for (const ch of line) {
    if (ch === '|' && !esc) count++
    esc = !esc && ch === '\\'
  }
  return count
}

const DELIMITER_ROW = /^\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*$/

/** A2: rejoins table rows that Notion broke at newlines inside cells, using `<br>`. */
export function joinBrokenTableRows(md: string): string {
  const starts = lineStarts(md)
  const lines = md.split('\n')

  // The parser misreads broken rows, so it is only used to keep out of code.
  const codeLines = new Set<number>()
  markdownLanguage.parser.parse(md).iterate({
    enter(node) {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return
      const end = node.to > node.from && md[node.to - 1] === '\n' ? node.to - 1 : node.to
      for (let line = lineAt(starts, node.from); line <= lineAt(starts, end); line++) codeLines.add(line)
    },
  })

  const complete = (row: string, columns: number): boolean => countRowPipes(row) === columns + 1 && row.trimEnd().endsWith('|')

  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (codeLines.has(i) || !lines[i].startsWith('|')) {
      out.push(lines[i++])
      continue
    }
    let end = i
    while (end < lines.length && lines[end].trim() !== '' && !codeLines.has(end)) end++
    // The block [i, end) is a table only if it has a delimiter row; Notion
    // always writes one, and it fixes the column count.
    let d = i + 1
    while (d < end && !DELIMITER_ROW.test(lines[d])) d++
    const columns = d < end ? countRowPipes(lines[d]) - 1 : 0
    const header = d < end ? lines.slice(i, d).join('<br>') : ''
    if (d >= end || !complete(header, columns)) {
      out.push(...lines.slice(i, end))
      i = end
      continue
    }
    out.push(header, lines[d])
    let j = d + 1
    while (j < end && lines[j].startsWith('|')) {
      let k = j
      let row = lines[j]
      while (!complete(row, columns) && countRowPipes(row) <= columns + 1 && k + 1 < end) row += '<br>' + lines[++k]
      if (!complete(row, columns)) break
      out.push(row)
      j = k + 1
    }
    // Whatever is left (a line that is not a row, or an unrepairable row) stays as written.
    out.push(...lines.slice(j, end))
    i = end
  }
  return out.join('\n')
}

/** A3: gives every top-level table an empty header row; the old header becomes the first data row. */
export function addEmptyHeaders(md: string): string {
  const tables = topLevelBlocks(md).filter((block) => block.name === 'Table')
  if (tables.length === 0) return md
  const lines = md.split('\n')
  // Bottom-up, so the line numbers of the tables still to do stay valid.
  for (const { firstLine } of tables.reverse()) {
    const header = lines[firstLine]
    const delimiter = lines[firstLine + 1]
    const columns = delimiter.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length
    lines.splice(firstLine, 2, '|' + '  |'.repeat(columns), delimiter, header)
  }
  return lines.join('\n')
}

/** A1: drops the single blank line between top-level blocks wherever the parse stays the same. */
export function collapseBlockGaps(md: string): string {
  const blocks = topLevelBlocks(md)
  if (blocks.length < 2) return md

  const lines = md.split('\n')
  const drop = new Set<number>()
  const textOf = (block: Block): string => lines.slice(block.firstLine, block.lastLine + 1).join('\n')

  // Each join is tested against the last top-level node of the output so far,
  // because only that node can still be open when the next block starts.
  let tail = textOf(blocks[0])
  let tailName = blocks[0].name
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1]
    const b = blocks[i]
    const bText = textOf(b)
    const oneBlankLine = b.firstLine - a.lastLine === 2 && /^[ \t]*$/.test(lines[a.lastLine + 1])
    if (!oneBlankLine) {
      tail = bText
      tailName = b.name
      continue
    }

    const tailLines = tail.split('\n').length
    const joined = topLevelBlocks(tail + '\n' + bText)
    const separate =
      joined.length === 2 &&
      joined[0].name === tailName &&
      joined[0].firstLine === 0 &&
      joined[1].name === b.name &&
      joined[1].firstLine === tailLines
    // The editor shows source lines 1:1, so a paragraph followed by a paragraph
    // reads the same without the blank line.
    const merged = tailName === 'Paragraph' && b.name === 'Paragraph' && joined.length === 1 && joined[0].name === 'Paragraph'
    if (separate) {
      drop.add(a.lastLine + 1)
      tail = bText
      tailName = b.name
    } else if (merged) {
      drop.add(a.lastLine + 1)
      tail += '\n' + bText
    } else {
      tail = bText
      tailName = b.name
    }
  }
  return lines.filter((_, index) => !drop.has(index)).join('\n')
}
