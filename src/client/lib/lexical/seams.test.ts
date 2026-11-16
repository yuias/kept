import { $createHorizontalRuleNode } from '@lexical/extension'
import { $createListItemNode, $createListNode } from '@lexical/list'
import { $createQuoteNode } from '@lexical/rich-text'
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellHeaderStates } from '@lexical/table'
import { $createParagraphNode, $createTextNode, $getRoot, type ElementNode, type LexicalNode, type TextNode } from 'lexical'
import { marked } from 'marked'
import { describe, expect, it } from 'vitest'
import { $exportMarkdown, $importMarkdown, $rootSeams, createMarkdownEditor, roundTrip } from './markdown'
import { $createCardNode } from './nodes/card-node'

const CARD_URL = 'https://e.example'

const paragraph = (value: string) => $createParagraphNode().append($createTextNode(value))
const rule = () => $createHorizontalRuleNode()
const card = () => $createCardNode(CARD_URL)
const orderedList = (start: number) => $createListNode('number', start).append($createListItemNode().append($createTextNode('x')))
const bulletList = () => $createListNode('bullet').append($createListItemNode().append($createTextNode('x')))
const quote = () => $createQuoteNode().append($createTextNode('q'))
const table = (...rows: string[][]) =>
  $createTableNode().append(
    ...rows.map((cells, index) =>
      $createTableRowNode().append(
        ...cells.map((value) =>
          $createTableCellNode(index === 0 ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS).append(paragraph(value)),
        ),
      ),
    ),
  )

const blockTypes = (markdown: string) => marked.lexer(markdown).map((token) => token.type).filter((type) => type !== 'space')

/** Exports a document built from `build`, as the editor writes it without any loaded seams. */
function exportBuilt(build: () => LexicalNode[]): string {
  const editor = createMarkdownEditor()
  editor.update(() => $getRoot().clear().append(...build()), { discrete: true })
  const markdown = editor.read(() => $exportMarkdown())
  editor.dispose()
  return markdown
}

/** Loads `markdown`, applies `edit`, and exports with the seams recorded at load. */
function exportEdited(markdown: string, edit: () => void): string {
  const editor = createMarkdownEditor()
  editor.update(() => $importMarkdown(markdown), { discrete: true })
  const loadedSeams = editor.read($rootSeams)
  editor.update(edit, { discrete: true })
  const exported = editor.read(() => $exportMarkdown(undefined, loadedSeams))
  editor.dispose()
  return exported
}

const setLastParagraphText = (value: string) => {
  const last = $getRoot().getLastChild() as ElementNode
  ;(last.getFirstChild() as TextNode).setTextContent(value)
}

describe('blocks made in the editor', () => {
  // [name, blocks, what marked reads in the export]
  const cases: [string, () => LexicalNode[], string[]][] = [
    ['paragraph + rule', () => [paragraph('a'), rule()], ['paragraph', 'hr']],
    ['paragraph + table', () => [paragraph('a'), table(['h'], ['x'])], ['paragraph', 'table']],
    ['paragraph + ordered list from 2', () => [paragraph('a'), orderedList(2)], ['paragraph', 'list']],
    ['list + paragraph', () => [bulletList(), paragraph('b')], ['list', 'paragraph']],
    ['quote + paragraph', () => [quote(), paragraph('b')], ['blockquote', 'paragraph']],
    ['card + rule', () => [card(), rule()], ['paragraph', 'hr']],
    ['table + table', () => [table(['h'], ['x']), table(['i'], ['y'])], ['table', 'table']],
    ['table + paragraph', () => [table(['h'], ['x']), paragraph('z')], ['table', 'paragraph']],
    ['table + paragraph that starts with a pipe', () => [table(['h'], ['x']), paragraph('|z')], ['table', 'paragraph']],
    ['paragraph that looks like a table header + table', () => [paragraph('| a |'), table(['-'], ['y'])], ['paragraph', 'table']],
  ]

  it.each(cases)('%s reads as the same blocks and is a fixed point', (_name, build, types) => {
    const markdown = exportBuilt(build)
    expect(blockTypes(markdown)).toEqual(types)
    const again = roundTrip(markdown)
    expect(again).toBe(markdown)
    expect(blockTypes(again)).toEqual(types)
  })

  it('separates blocks that GFM would join with a blank line', () => {
    expect(exportBuilt(() => [paragraph('a'), rule()])).toBe('a\n\n---')
    expect(exportBuilt(() => [table(['h'], ['x']), table(['i'], ['y'])])).toBe('| h |\n| --- |\n| x |\n\n| i |\n| --- |\n| y |')
    expect(exportBuilt(() => [table(['h'], ['x']), paragraph('z')])).toBe('| h |\n| --- |\n| x |\n\nz')
  })

  it('keeps a single newline between paragraphs', () => {
    expect(exportBuilt(() => [paragraph('a'), paragraph('b')])).toBe('a\nb')
    expect(roundTrip('a\nb')).toBe('a\nb')
  })

  it('keeps a single newline between a card and a paragraph, in both orders and between cards', () => {
    expect(exportBuilt(() => [card(), paragraph('b')])).toBe(`@[card](${CARD_URL})\nb`)
    expect(exportBuilt(() => [paragraph('b'), card()])).toBe(`b\n@[card](${CARD_URL})`)
    expect(exportBuilt(() => [card(), card()])).toBe(`@[card](${CARD_URL})\n@[card](${CARD_URL})`)
  })

  it('writes nothing extra around an empty paragraph', () => {
    expect(exportBuilt(() => [paragraph('a'), $createParagraphNode(), rule()])).toBe('a\n\n---')
    expect(exportBuilt(() => [paragraph('a'), $createParagraphNode(), $createParagraphNode(), rule()])).toBe('a\n\n\n---')
    expect(exportBuilt(() => [rule(), $createParagraphNode(), paragraph('a')])).toBe('---\n\na')
    expect(exportBuilt(() => [])).toBe('')
  })
})

describe('seams that were there when the note was loaded', () => {
  it.each([
    ['a list item followed by a line', '- a\nb\n'],
    ['a quote followed by a line', '> q\nb\n'],
    ['a list item that holds a fenced block', '- item\n    ```\n    code in item\n    ```\n- next\n'],
  ])('keeps the bytes of %s', (_name, source) => {
    expect(roundTrip(source)).toBe(source)
  })

  it('keeps the seam while one of the blocks is edited', () => {
    const output = exportEdited('- a\nb', () => {
      setLastParagraphText('bX')
    })
    expect(output).toBe('- a\nbX')
  })

  it('separates a block inserted into a loaded seam', () => {
    const output = exportEdited('- a\nb', () => {
      $getRoot().getFirstChildOrThrow().insertAfter(paragraph('c'))
    })
    expect(output).toBe('- a\n\nc\nb')
  })

  it('separates a loaded paragraph after a table once it is edited to start with a pipe', () => {
    const source = '| a |\n| --- |\n| b |\nx'
    expect(roundTrip(source)).toBe(source)
    const output = exportEdited(source, () => setLastParagraphText('|x'))
    expect(output).toBe('| a |\n| --- |\n| b |\n\n|x')
    expect(blockTypes(output)).toEqual(['table', 'paragraph'])
    expect(roundTrip(output)).toBe(output)
  })

  it('separates a loaded paragraph before a table once it is edited into a header', () => {
    const source = 'p\n| - |\n| --- |\n| y |'
    expect(roundTrip(source)).toBe(source)
    const output = exportEdited(source, () => {
      const first = $getRoot().getFirstChild() as ElementNode
      ;(first.getFirstChild() as TextNode).setTextContent('| x |')
    })
    expect(output).toBe('| x |\n\n| - |\n| --- |\n| y |')
    expect(blockTypes(output)).toEqual(['paragraph', 'table'])
    expect(roundTrip(output)).toBe(output)
  })

  it('checks a pair that becomes adjacent after a deletion', () => {
    const output = exportEdited('- a\n\nb', () => {
      $getRoot().getChildren()[1]!.remove()
    })
    expect(output).toBe('- a\n\nb')
  })
})
