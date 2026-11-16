import { $createLinkNode } from '@lexical/link'
import { $createListItemNode, $createListNode } from '@lexical/list'
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  TableCellHeaderStates,
} from '@lexical/table'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getState,
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  type LexicalNode,
} from 'lexical'
import { describe, expect, it } from 'vitest'
import { classifyRoundTrip } from './fidelity'
import { $exportMarkdown, $importMarkdown, createMarkdownEditor, roundTrip } from './markdown'
import { $createImageNode } from './nodes/image-node'
import { isTableStart, tableHeaderlessState } from './table-transformer'

interface CellShape {
  header: boolean
  align: string
  text: string
}

/** Imports `markdown`; a table becomes its rows of cells, any other root child its type and text. */
function shape(markdown: string): unknown[] {
  const editor = createMarkdownEditor()
  editor.update(() => $importMarkdown(markdown), { discrete: true })
  const result = editor.read(() =>
    $getRoot()
      .getChildren()
      .map((node) =>
        $isTableNode(node)
          ? node.getChildren().map((row) =>
              (row as unknown as { getChildren: () => LexicalNode[] }).getChildren().map(
                (cell): CellShape => ({
                  header: $isTableCellNode(cell) && cell.hasHeader(),
                  align: $isTableCellNode(cell) ? cell.getFormatType() : '',
                  text: cell.getTextContent(),
                }),
              ),
            )
          : node.getTextContent() === ''
            ? node.getType()
            : [node.getType(), node.getTextContent()],
      ),
  )
  editor.dispose()
  return result
}

const texts = (rows: unknown): string[][] => (rows as CellShape[][]).map((row) => row.map((cell) => cell.text))

const text = (value: string, format = 0) => $createTextNode(value).setFormat(format)
const paragraph = (...children: LexicalNode[]) => $createParagraphNode().append(...children)
const cell = (header: boolean, ...blocks: LexicalNode[]) =>
  $createTableCellNode(header ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS).append(...blocks)
const table = (...rows: LexicalNode[][]) => $createTableNode().append(...rows.map((cells) => $createTableRowNode().append(...cells)))

/** Exports a document made of `build()`, reimports the markdown, and exports it again. */
function exportAndReload(build: () => LexicalNode[]): { markdown: string; shape: unknown[]; again: string } {
  const editor = createMarkdownEditor()
  editor.update(() => $getRoot().clear().append(...build()), { discrete: true })
  const markdown = editor.read(() => $exportMarkdown())
  editor.dispose()
  return { markdown, shape: shape(markdown), again: roundTrip(markdown) }
}

describe('table import', () => {
  it('reads a header row, alignments and body rows', () => {
    const rows = shape('| a | b |\n| :--- | ---: |\n| c | d |') as CellShape[][][]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([
      [
        { header: true, align: 'left', text: 'a' },
        { header: true, align: 'right', text: 'b' },
      ],
      [
        { header: false, align: 'left', text: 'c' },
        { header: false, align: 'right', text: 'd' },
      ],
    ])
  })

  it('reads a centered column and a column without alignment', () => {
    const [rows] = shape('| a | b |\n| :-: | - |\n| c | d |') as CellShape[][][]
    expect(rows![0]!.map((c) => c.align)).toEqual(['center', ''])
  })

  it('reads `\\|` as a pipe inside one cell', () => {
    const [rows] = shape('| a \\| b | c |\n| --- | --- |') as unknown[][][]
    expect(texts(rows)).toEqual([['a | b', 'c']])
  })

  it('keeps `\\\\` and a pipe after it apart', () => {
    const [rows] = shape('| a \\\\| b |\n| --- | --- |') as unknown[][][]
    expect(texts(rows)).toEqual([['a \\', 'b']])
  })

  it('pads a short row and drops extra cells', () => {
    const [rows] = shape('| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 | 5 |') as unknown[][][]
    expect(texts(rows)).toEqual([['a', 'b', 'c'], ['1', '', ''], ['1', '2', '3']])
  })

  it('reads rows without the outer pipes of the last cell', () => {
    const [rows] = shape('|a|b\n|-|-\n|1|2') as unknown[][][]
    expect(texts(rows)).toEqual([['a', 'b'], ['1', '2']])
  })

  it('ends the table at the first line that does not start with a pipe', () => {
    expect(shape('| a |\n| - |\n| 1 |\nafter\n\n| 2 |')).toEqual([
      [[{ header: true, align: '', text: 'a' }], [{ header: false, align: '', text: '1' }]],
      ['paragraph', 'after'],
      'paragraph',
      ['paragraph', '| 2 |'],
    ])
  })

  it('keeps a table with only a header row', () => {
    expect(texts((shape('| a | b |\n| - | - |') as unknown[][][])[0])).toEqual([['a', 'b']])
  })

  it('reads inline markup, links and images in cells', () => {
    const source = '| **b** | `c` | [t](https://e.example/a) | ![x](/img/abc) |\n| --- | --- | --- | --- |'
    expect(roundTrip(source)).toBe(source)
    const [rows] = shape(source) as unknown[][][]
    expect(texts(rows)).toEqual([['b', 'c', 't', '![x](/img/abc)']])
  })

  it('does not read block markup inside a cell', () => {
    const source = '| # a | - b | > c | @[card](https://e.example) |\n| --- | --- | --- | --- |'
    expect(roundTrip(source)).toBe(source)
    expect(texts((shape(source) as unknown[][][])[0])).toEqual([['# a', '- b', '> c', '@card']])
  })

  it('keeps `<br>` in a cell as written', () => {
    const source = '| a<br>b | c |\n| --- | --- |'
    expect(roundTrip(source)).toBe(source)
  })
})

describe('what starts a table', () => {
  it.each([
    ['| a |', '| --- |'],
    ['| a | b |', '|---|---|'],
    ['| a | b |', '|  ---  |  :-:  |'],
    ['|a|b|', '|-|-'],
    ['| a |', '| --- | '],
    ['| a \\| b |', '| --- |'],
  ])('reads %j followed by %j', (header, delimiter) => {
    expect(isTableStart(header, delimiter)).toBe(true)
  })

  it.each([
    ['| a |', '| |'],
    ['| a |', '||'],
    ['| a |', '| : |'],
    ['| a |', '| -- -- |'],
    ['| a | b |', '| --- |'],
    ['| a |', '| --- | --- |'],
    ['a | b', '--- | ---'],
    ['a | b', '| --- | --- |'],
    [' | a |', '| --- |'],
    ['|', '| --- |'],
    ['| a |', ' | --- |'],
    ['| a |', undefined],
  ])('does not read %j followed by %j', (header, delimiter) => {
    expect(isTableStart(header, delimiter)).toBe(false)
  })

  it.each([
    '| a | b |\n| --- |',
    '| a |\n| |',
    'a | b\n--- | ---',
    '| a |',
    '|x',
    '| a | b |\n\n| --- | --- |',
    '> | a |\n> | --- |',
    '- | a |\n  | --- |',
    '    | a |\n    | --- |',
  ])('keeps the bytes of lines that are not a table: %j', (source) => {
    expect(roundTrip(source)).toBe(source)
    expect(shape(source).some((node) => (node as unknown[])[0] instanceof Array)).toBe(false)
  })
})

describe('tabs and carriage returns', () => {
  it.each(['| a |\n|\t-\t|', '| a |\n| -\t|', '| a |\n| - |\t'])('does not read a delimiter row with a tab: %j', (source) => {
    expect(roundTrip(source)).toBe(source)
    expect(shape(source).some((node) => (node as unknown[])[0] instanceof Array)).toBe(false)
  })

  it('reads tabs in header and body rows', () => {
    expect(texts((shape('|\ta\t|\n| - |\n|\tb\t|') as unknown[][][])[0])).toEqual([['a'], ['b']])
  })

  it('still reads a table with CRLF line ends', () => {
    expect(texts((shape('| a |\r\n| - |\r\n| b |\r\n') as unknown[][][])[0])).toEqual([['a'], ['b']])
  })
})

describe('table export', () => {
  it('writes the canonical shape', () => {
    expect(roundTrip('|a|b|c|\n|-|:-|-:|\n|1|2|3|')).toBe('| a | b | c |\n| --- | :--- | ---: |\n| 1 | 2 | 3 |')
    expect(roundTrip('| a |\n|:-:|\n| 1 |')).toBe('| a |\n| :---: |\n| 1 |')
  })

  it('is a fixed point', () => {
    const once = roundTrip('|a|b|\n|-|-:|\n|1|\n|1|2|3|')
    expect(roundTrip(once)).toBe(once)
    expect(classifyRoundTrip('|a|b|\n|-|-:|\n|1|\n|1|2|3|', once)).toBe('render-equal')
  })

  it('writes `<br>` for a second paragraph and for a line break in a cell', () => {
    const { markdown } = exportAndReload(() => [
      table([cell(true, paragraph(text('h')))], [cell(false, paragraph(text('a')), paragraph(text('b')))], [cell(false, paragraph(text('a'), $createLineBreakNode(), text('b')))]),
    ])
    expect(markdown).toBe('| h |\n| --- |\n| a<br>b |\n| a<br>b |')
  })

  it('trims the spaces around cell text', () => {
    const { markdown, again } = exportAndReload(() => [table([cell(true, paragraph(text('  a  ')))], [cell(false, paragraph(text(' b')))])])
    expect(markdown).toBe('| a |\n| --- |\n| b |')
    expect(again).toBe(markdown)
  })

  it('writes empty cells', () => {
    const { markdown } = exportAndReload(() => [table([cell(true, paragraph()), cell(true, paragraph())], [cell(false, paragraph()), cell(false, paragraph(text('x')))])])
    expect(markdown).toBe('|  |  |\n| --- | --- |\n|  | x |')
  })
})

describe('tables built in the editor', () => {
  const build = (): LexicalNode[] => [
    table(
      [cell(true, paragraph(text('h1'))), cell(true, paragraph(text('h2'))), cell(true, paragraph(text('h3')))],
      [
        cell(false, paragraph(text('b', IS_BOLD))),
        cell(false, paragraph(text('i', IS_ITALIC))),
        cell(false, paragraph(text('c', IS_CODE), text(' '), text('s', IS_STRIKETHROUGH))),
      ],
      [cell(false, paragraph(text('a|b'))), cell(false, paragraph(text('a\\b'))), cell(false, paragraph(text('\\|')))],
      [
        cell(false, paragraph(text('x '), $createLinkNode('https://e.example/a').append(text('lnk')))),
        cell(false, paragraph($createImageNode('/img/abc', 'alt', null))),
        cell(false, paragraph(text('*lit* [x](y)'))),
      ],
      [cell(false, paragraph(text('a|b', IS_CODE))), cell(false, paragraph(text('|'))), cell(false, paragraph(text('||')))],
    ),
  ]

  it('exports and reimports inline formats, pipes, backslashes, links and images', () => {
    const { markdown, shape: reloaded, again } = exportAndReload(build)
    expect(markdown).toBe(
      [
        '| h1 | h2 | h3 |',
        '| --- | --- | --- |',
        '| **b** | *i* | `c` ~~s~~ |',
        '| a\\|b | a\\b | \\\\\\| |',
        '| x [lnk](https://e.example/a) | ![alt](/img/abc) | \\*lit\\* \\[x](y) |',
        '| `a\\|b` | \\| | \\|\\| |',
      ].join('\n'),
    )
    expect(again).toBe(markdown)
    expect(texts(reloaded[0])).toEqual([
      ['h1', 'h2', 'h3'],
      ['b', 'i', 'c s'],
      ['a|b', 'a\\b', '\\|'],
      ['x lnk', '![alt](/img/abc)', '*lit* [x](y)'],
      ['a|b', '|', '||'],
    ])
  })

  it('keeps a code span with a backslash and a pipe as a fixed point', () => {
    // GFM cannot write this text in a cell: `\|` always means a pipe, so the backslash is dropped (`a\|b` reloads as `a|b`).
    const { markdown, shape: reloaded, again } = exportAndReload(() => [table([cell(true, paragraph(text('a\\|b', IS_CODE)))])])
    expect(texts(reloaded[0])).toEqual([['a|b']])
    expect(again).toBe(markdown)
  })

  it('keeps alignment through an editor round trip', () => {
    const editor = createMarkdownEditor()
    editor.update(
      () => {
        $importMarkdown('| a | b |\n| :-: | ---: |\n| 1 | 2 |')
      },
      { discrete: true },
    )
    expect(editor.read(() => $exportMarkdown())).toBe('| a | b |\n| :---: | ---: |\n| 1 | 2 |')
    editor.dispose()
  })

  it('keeps a table next to a list apart from the list', () => {
    const { markdown, again } = exportAndReload(() => [
      table([cell(true, paragraph(text('h')))], [cell(false, paragraph(text('x')))]),
      paragraph(),
      $createListNode('bullet').append($createListItemNode().append(text('item'))),
    ])
    expect(markdown).toBe('| h |\n| --- |\n| x |\n\n- item')
    expect(again).toBe(markdown)
  })
})

describe('paragraphs that start with a pipe', () => {
  const paragraphs = (...lines: string[]) => lines.map((line) => paragraph(text(line)))
  const keeps = (name: string, build: () => LexicalNode[], expected: string, tables = 0) =>
    it(name, () => {
      const { markdown, shape: reloaded, again } = exportAndReload(build)
      expect(markdown).toBe(expected)
      expect(again).toBe(markdown)
      expect(reloaded.filter((node) => (node as unknown[])[0] instanceof Array)).toHaveLength(tables)
    })

  keeps('separates a line after a table, which would become a row', () => [table([cell(true, paragraph(text('h')))], [cell(false, paragraph(text('x')))]), ...paragraphs('|x')], '| h |\n| --- |\n| x |\n\n|x', 1)
  keeps('keeps a line before a table', () => [...paragraphs('|x'), table([cell(true, paragraph(text('h')))])], '|x\n| h |\n| --- |', 1)
  keeps('keeps a line after a blank line that follows a table', () => [table([cell(true, paragraph(text('h')))]), paragraph(), ...paragraphs('|x')], '| h |\n| --- |\n\n|x', 1)
  keeps('escapes a line that a delimiter paragraph would turn into a header', () => paragraphs('| a |', '| --- |'), '\\| a |\n| --- |')
  keeps('escapes a header and the delimiter line it would form with the next one', () => paragraphs('| a |', '| --- |', '| --- |'), '\\| a |\n\\| --- |\n| --- |')
  keeps('keeps lines that do not form a table', () => paragraphs('|x', '| a | b |', '| --- |'), '|x\n| a | b |\n| --- |')
  keeps(
    'separates a line from a table whose header row is a delimiter row',
    () => [...paragraphs('| x |'), table([cell(true, paragraph(text('-')))], [cell(false, paragraph(text('y')))])],
    '| x |\n\n| - |\n| --- |\n| y |',
    1,
  )
  keeps(
    'separates a line from a table whose header cell is a centered delimiter',
    () => [...paragraphs('| x |'), table([cell(true, paragraph(text(':-:')))], [cell(false, paragraph(text('y')))])],
    '| x |\n\n| :-: |\n| --- |\n| y |',
    1,
  )
  keeps('escapes inside one paragraph with a line break', () => [paragraph(text('| a |'), $createLineBreakNode(), text('| --- |'))], '\\| a |\n| --- |')
})

describe('lists around a table', () => {
  // The cell text is imported by a nested call that must restore the list columns of the outer import.
  it('keeps the nesting of a list that continues after a table', () => {
    expect(roundTrip('- a\n  - b\n| h |\n| - |\n  - c')).toBe(roundTrip('- a\n  - b\nx\n  - c').replace('\nx\n', '\n| h |\n| --- |\n'))
  })

  it('imports a nested list after a table as it does without one', () => {
    expect(roundTrip('| h |\n| - |\n\n- a\n  - b\n    - c')).toBe(`| h |\n| --- |\n\n${roundTrip('- a\n  - b\n    - c')}`)
  })
})

/** Imports `markdown` and describes the children of the first paragraph of every cell of the first table. */
function cellContents(markdown: string): string[][][] {
  const editor = createMarkdownEditor()
  editor.update(() => $importMarkdown(markdown), { discrete: true })
  const result = editor.read(() => {
    const [first] = $getRoot().getChildren()
    if (!$isTableNode(first)) throw new Error('not a table')
    return first.getChildren().map((row) =>
      (row as unknown as { getChildren: () => LexicalNode[] }).getChildren().map((cell) =>
        (cell as unknown as { getFirstChild: () => { getChildren: () => LexicalNode[] } }).getFirstChild().getChildren().map((child) =>
          child.getType() === 'text' ? `${child.getTextContent()}${(child as ReturnType<typeof $createTextNode>).getFormat() ? '*' : ''}` : `<${child.getType()}>`,
        ),
      ),
    )
  })
  editor.dispose()
  return result
}

describe('headerless tables', () => {
  const source = '|  |  |\n| --- | --- |\n| a | b |\n| c | d |'

  it('reads an empty header row followed by body rows as body rows only', () => {
    const [rows] = shape(source) as CellShape[][][]
    expect(rows!.map((row) => row.map((c) => c.header))).toEqual([
      [false, false],
      [false, false],
    ])
    expect(texts(rows)).toEqual([['a', 'b'], ['c', 'd']])
    expect(roundTrip(source)).toBe(source)
  })

  it('marks the table and keeps the alignments on the body cells', () => {
    const editor = createMarkdownEditor()
    editor.update(() => $importMarkdown('|||\n| :-- | --: |\n| a | b |'), { discrete: true })
    editor.read(() => {
      const [node] = $getRoot().getChildren()
      expect($getState(node as never, tableHeaderlessState)).toBe(true)
    })
    expect(shape('|||\n| :-- | --: |\n| a | b |')).toEqual([[[{ header: false, align: 'left', text: 'a' }, { header: false, align: 'right', text: 'b' }]]])
    expect(roundTrip('| |  |\n| :-- | --: |\n| a | b |')).toBe('|  |  |\n| :--- | ---: |\n| a | b |')
    editor.dispose()
  })

  it('keeps the empty header row of a table without body rows', () => {
    const [rows] = shape('|  |  |\n| --- | --- |') as CellShape[][][]
    expect(rows!.map((row) => row.map((c) => c.header))).toEqual([[true, true]])
    expect(roundTrip('|  |  |\n| --- | --- |')).toBe('|  |  |\n| --- | --- |')
  })

  it('keeps a header row with one non-empty cell, including a cell that is only `<br>`', () => {
    for (const header of ['| a |  |', '| <br> |  |']) {
      const [rows] = shape(`${header}\n| --- | --- |\n| 1 | 2 |`) as CellShape[][][]
      expect(rows![0]!.map((c) => c.header)).toEqual([true, true])
    }
  })

  it('writes an empty header row for a first row that is not a header row', () => {
    const { markdown, again } = exportAndReload(() => [table([cell(false, paragraph(text('a'))), cell(false, paragraph(text('b')))])])
    expect(markdown).toBe('|  |  |\n| --- | --- |\n| a | b |')
    expect(again).toBe(markdown)
  })

  it('exports the header row of an editor-built table whose header text was deleted, and reads it back headerless', () => {
    const { markdown, shape: reloaded, again } = exportAndReload(() => [
      table([cell(true, paragraph()), cell(true, paragraph())], [cell(false, paragraph(text('a'))), cell(false, paragraph(text('b')))]),
    ])
    expect(markdown).toBe('|  |  |\n| --- | --- |\n| a | b |')
    expect(again).toBe(markdown)
    expect((reloaded[0] as CellShape[][]).map((row) => row.map((c) => c.header))).toEqual([[false, false]])
  })

  it('keeps a table with an emptied header row and no body rows as it is', () => {
    const { markdown, again } = exportAndReload(() => [table([cell(true, paragraph()), cell(true, paragraph())])])
    expect(markdown).toBe('|  |  |\n| --- | --- |')
    expect(again).toBe(markdown)
  })
})

describe('`<br>` in a cell', () => {
  it.each(['<br>', '<br/>', '<br />', '<BR>', '<Br />'])('reads %s as a line break', (br) => {
    expect(cellContents(`| h |\n| - |\n| a${br}b |`)[1]![0]).toEqual(['a', '<linebreak>', 'b'])
  })

  // A line break has no spelling to remember; the fidelity guard compares the spellings as equal.
  it('normalizes the spelling to `<br>`', () => {
    expect(roundTrip('| a<br/>b | c<BR />d |\n| --- | --- |')).toBe('| a<br>b | c<br>d |\n| --- | --- |')
    expect(classifyRoundTrip('| a<br/>b | c<BR />d |\n| --- | --- |', '| a<br>b | c<br>d |\n| --- | --- |')).toBe('render-equal')
  })

  it('reads a cell that is only `<br>`, a leading one and a trailing one', () => {
    expect(cellContents('| <br> | <br>a | a<br> |\n| - | - | - |')[0]).toEqual([['<linebreak>'], ['<linebreak>', 'a'], ['a', '<linebreak>']])
    const source = '| <br> | <br>a | a<br> |\n| --- | --- | --- |'
    expect(roundTrip(source)).toBe(source)
  })

  it('keeps the format on both sides of a break', () => {
    expect(cellContents('| **a<br>b** | `x` |\n| - | - |')[0]![0]).toEqual(['a*', '<linebreak>', 'b*'])
  })

  it('does not read `<br>` inside a code span or after a backslash as a break', () => {
    expect(cellContents('| `a<br>b` | a\\<br>b | a\\\\<br>b |\n| - | - | - |')[0]).toEqual([['a<br>b*'], ['a<br>b'], ['a\\', '<linebreak>', 'b']])
  })

  it('does not leak the marker character into a cell that contains it', () => {
    expect(cellContents('| \u2020\\<br>\u2021<br>\u2022 |\n| - |')[0]).toEqual([['\u2020<br>\u2021', '<linebreak>', '\u2022']])
  })

  it.each([
    ['**a:**<br>b', ['a:*', '<linebreak>', 'b']],
    ['a<br>_b_', ['a', '<linebreak>', 'b*']],
    ['a<br>**(b)**', ['a', '<linebreak>', '(b)*']],
    ['**太字。**<br>次', ['太字。*', '<linebreak>', '次']],
    ['__a__<br>b', ['a*', '<linebreak>', 'b']],
  ])('keeps emphasis next to a break: %s', (cellSource, expected) => {
    expect(cellContents(`| ${cellSource} |\n| - |`)[0]![0]).toEqual(expected)
  })

  it.each([
    '[t](https://e.example/a\\<br>b)',
    '![a\\<br>b](/img/abc)',
    '![a](/img/abc "x\\<br>y")',
    '[t](https://e.example "a\\<br>b")',
    '[a\\<br>b](https://e.example)',
  ])('does not leave the marker character in the fields of an escaped `<br>`: %s', (cellSource) => {
    const source = `| ${cellSource} |\n| --- |`
    const exported = roundTrip(source)
    expect(exported).not.toMatch(/\u2020/)
    expect(classifyRoundTrip(source, exported)).not.toBe('render-different')
  })

  it.each([
    'https://e.example/a_b<br>x',
    'see https://e.example/~u/x_y<br>x',
    'snake_case<br>x',
    'a_b_c<br>d',
    'a * b<br>c',
    '[x] y<br>z',
  ])('keeps the bytes of a cell with plain text next to a break: %s', (cellSource) => {
    const source = `| ${cellSource} |\n| --- |`
    expect(roundTrip(source)).toBe(source)
  })

  it.each(['![a<br>b](/img/abc)', '[t](https://e.example/a<br>b)', '[t](https://e.example "a<br>b")'])('keeps `<br>` in the attributes of %s', (cellSource) => {
    const source = `| ${cellSource} |\n| --- |`
    expect(roundTrip(source)).toBe(source)
  })

  it('reads a break inside a link label', () => {
    const source = '| [a<br>b](https://e.example/x) |\n| --- |'
    expect(roundTrip(source)).toBe(source)
  })

  it('reads breaks in body rows without changing the neighbouring cells', () => {
    expect(cellContents('| h | i |\n| - | - |\n| a<br>b | c |')[1]).toEqual([['a', '<linebreak>', 'b'], ['c']])
  })
})

describe('`<br>` written from the editor', () => {
  it('writes a line break and a second paragraph, which read back as a line break', () => {
    const { markdown, again } = exportAndReload(() => [
      table([cell(true, paragraph(text('h')))], [cell(false, paragraph(text('a'), $createLineBreakNode(), text('b')))], [cell(false, paragraph(text('a')), paragraph(text('b')))]),
    ])
    expect(markdown).toBe('| h |\n| --- |\n| a<br>b |\n| a<br>b |')
    expect(again).toBe(markdown)
  })

  it('writes a cell that is only a line break', () => {
    const { markdown, again } = exportAndReload(() => [table([cell(true, paragraph(text('h')))], [cell(false, paragraph($createLineBreakNode()))])])
    expect(markdown).toBe('| h |\n| --- |\n| <br> |')
    expect(again).toBe(markdown)
  })

  it('keeps typed `<br>` text as text by escaping it in a cell', () => {
    const { markdown, shape: reloaded, again } = exportAndReload(() => [
      table([cell(true, paragraph(text('h')))], [cell(false, paragraph(text('a<br>b')))], [cell(false, paragraph(text('x<BR />y', IS_BOLD)))]),
    ])
    expect(markdown).toBe('| h |\n| --- |\n| a\\<br>b |\n| **x\\<BR />y** |')
    expect(again).toBe(markdown)
    expect(texts(reloaded[0])).toEqual([['h'], ['a<br>b'], ['x<BR />y']])
  })

  it('keeps a backslash before typed `<br>` text', () => {
    const { markdown, shape: reloaded, again } = exportAndReload(() => [table([cell(true, paragraph(text('h')))], [cell(false, paragraph(text('a\\<br>b')))])])
    expect(again).toBe(markdown)
    expect(texts(reloaded[0])).toEqual([['h'], ['a\\<br>b']])
  })

  it.each([
    ['*a', 'b*'],
    ['`a', 'b`'],
    ['[a', 'b](https://e.example)'],
    ['**a', 'b**'],
    ['_a', 'b_'],
    ['~~a', 'b~~'],
  ])('keeps typed %j and %j around a line break as text', (first, second) => {
    const { markdown, shape: reloaded, again } = exportAndReload(() => [
      table([cell(true, paragraph(text('h')))], [cell(false, paragraph(text(first), $createLineBreakNode(), text(second)))]),
    ])
    expect(again).toBe(markdown)
    expect(cellContents(markdown)[1]![0]).toEqual([first, '<linebreak>', second])
    expect(texts(reloaded[0])[1]).toEqual([`${first}\n${second}`])
  })

  it('writes a typed URL next to a break unescaped', () => {
    const { markdown } = exportAndReload(() => [
      table([cell(true, paragraph(text('h')))], [cell(false, paragraph(text('https://e.example/a_b'), $createLineBreakNode(), text('x')))]),
    ])
    expect(markdown).toBe('| h |\n| --- |\n| https://e.example/a_b<br>x |')
  })

  it('keeps typed markup characters in two paragraphs of a cell as text', () => {
    const { markdown, again } = exportAndReload(() => [table([cell(true, paragraph(text('h')))], [cell(false, paragraph(text('*a')), paragraph(text('b*')))])])
    expect(again).toBe(markdown)
    expect(cellContents(markdown)[1]![0]).toEqual(['*a', '<linebreak>', 'b*'])
  })

  it('leaves `<br>` text outside a table as it is', () => {
    expect(roundTrip('a<br>b')).toBe('a<br>b')
  })

  it('writes `<br>` text in a code span as it is', () => {
    const { markdown, again } = exportAndReload(() => [table([cell(true, paragraph(text('<br>', IS_CODE)))])])
    expect(markdown).toBe('| `<br>` |\n| --- |')
    expect(again).toBe(markdown)
  })
})
