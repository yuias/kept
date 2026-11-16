import { $isCodeNode } from '@lexical/code-core'
import { $isHeadingNode } from '@lexical/rich-text'
import {
  $createRangeSelection,
  $getRoot,
  $setCompositionKey,
  $setSelection,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  type TextFormatType,
  type TextNode,
} from 'lexical'
import { afterEach, describe, expect, it } from 'vitest'
import { formatBarState } from './format'
import { createTestEditor, pressEnter, settle, type TestEditor, typeText } from './test-editor'

const open: TestEditor[] = []
afterEach(() => {
  for (const t of open.splice(0)) t.editor.dispose()
})

const create = (markdown = ''): TestEditor => {
  const t = createTestEditor(markdown)
  open.push(t)
  return t
}

const firstText = (): TextNode => $getRoot().getAllTextNodes()[0]!

/**
 * Selects `from`..`to` of the first text node, or collapses at `from`. A selection
 * read from the DOM carries the format of the text it lands in; a programmatic one
 * does not, so it is copied here.
 */
function select({ editor }: TestEditor, from: number, to = from): void {
  editor.update(
    () => {
      const node = firstText()
      const selection = node.select(from, to)
      selection.setFormat(node.getFormat())
    },
    { discrete: true },
  )
}

const format = ({ editor }: TestEditor, type: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, type)

describe('format commands', () => {
  it('refuses formats markdown cannot store', () => {
    const t = create('abc')
    select(t, 0, 3)
    for (const type of ['underline', 'highlight', 'subscript', 'superscript', 'lowercase', 'uppercase', 'capitalize'] as const) {
      expect(format(t, type)).toBe(true)
    }
    expect(t.editor.read(() => firstText().getFormat())).toBe(0)
    expect(t.markdown()).toBe('abc')
  })

  it('toggles inline code and strikethrough', () => {
    const t = create('abc')
    select(t, 0, 3)
    format(t, 'code')
    expect(t.markdown()).toBe('`abc`')
    format(t, 'code')
    expect(t.markdown()).toBe('abc')
    format(t, 'strikethrough')
    expect(t.markdown()).toBe('~~abc~~')
    format(t, 'strikethrough')
    expect(t.markdown()).toBe('abc')
  })

  it('keeps the whitespace of a formatted selection outside the markers', () => {
    const t = create('foo bar')
    select(t, 0, 4)
    format(t, 'bold')
    expect(t.markdown()).toBe('**foo** bar')
  })

  it('stops a run at its end when the format is toggled there', async () => {
    const t = create('**abc**')
    select(t, 3)
    format(t, 'bold')
    await typeText(t.editor, 'd')
    expect(t.markdown()).toBe('**abc**d')
  })

  it('continues a collapsed format for the next characters', async () => {
    const t = create('abc ')
    select(t, 4)
    format(t, 'italic')
    await typeText(t.editor, 'd')
    expect(t.markdown()).toBe('abc *d*')
  })
})

describe('formatBarState', () => {
  it('is hidden for a collapsed selection', () => {
    const t = create('abc')
    select(t, 1)
    expect(formatBarState(t.editor)).toEqual({ visible: false, active: new Set() })
  })

  it('is shown for a range and reports the formats of the selected text', () => {
    const t = create('**abc** d')
    select(t, 0, 3)
    expect(formatBarState(t.editor)).toEqual({ visible: true, active: new Set(['bold']) })
    t.editor.update(
      () => {
        const [bold, plain] = $getRoot().getAllTextNodes() as [TextNode, TextNode]
        const selection = $createRangeSelection()
        selection.anchor.set(bold.getKey(), 0, 'text')
        selection.focus.set(plain.getKey(), 2, 'text')
        $setSelection(selection)
      },
      { discrete: true },
    )
    expect(formatBarState(t.editor)).toEqual({ visible: true, active: new Set() })
  })

  it('does not count a node the range only touches at its edge', () => {
    const t = create('**ab**cd')
    select(t, 0, 2)
    t.editor.update(
      () => {
        const [bold, plain] = $getRoot().getAllTextNodes() as [TextNode, TextNode]
        const selection = $createRangeSelection()
        selection.anchor.set(bold.getKey(), 2, 'text')
        selection.focus.set(plain.getKey(), 2, 'text')
        $setSelection(selection)
      },
      { discrete: true },
    )
    expect(formatBarState(t.editor)).toEqual({ visible: true, active: new Set() })
  })

  it('reports a link around the whole selection', () => {
    const t = create('[abc](https://e.example) d')
    select(t, 0, 3)
    expect(formatBarState(t.editor).active).toEqual(new Set(['link']))
  })

  it('does not report a bare URL as a link', () => {
    const t = create('https://e.example')
    select(t, 0, 5)
    expect(formatBarState(t.editor).active).toEqual(new Set())
  })

  it('is hidden in a code block', () => {
    const t = create('```\nabc\n```')
    expect(t.editor.read(() => $isCodeNode($getRoot().getFirstChild()))).toBe(true)
    select(t, 0, 2)
    expect(formatBarState(t.editor).visible).toBe(false)
  })

  it('is hidden while composing and while read-only', () => {
    const t = create('abc')
    select(t, 0, 2)
    t.editor.update(() => $setCompositionKey(firstText().getKey()), { discrete: true })
    expect(formatBarState(t.editor).visible).toBe(false)
    t.editor.update(() => $setCompositionKey(null), { discrete: true })
    expect(formatBarState(t.editor).visible).toBe(true)
    t.editor.setEditable(false)
    expect(formatBarState(t.editor).visible).toBe(false)
  })
})

describe('markdown shortcuts', () => {
  it('turns "# " at the start of an empty paragraph into a heading', async () => {
    const t = create()
    await typeText(t.editor, '# ')
    expect(t.editor.read(() => $isHeadingNode($getRoot().getFirstChild()))).toBe(true)
    await typeText(t.editor, 'title')
    expect(t.markdown()).toBe('# title')
  })

  it('does not convert while an IME composition is active', async () => {
    const t = create()
    await typeText(t.editor, '#')
    t.editor.update(() => $setCompositionKey(firstText().getKey()), { discrete: true })
    await typeText(t.editor, ' ')
    expect(t.editor.read(() => $isHeadingNode($getRoot().getFirstChild()))).toBe(false)
    expect(t.markdown()).toBe('\\# ')
  })

  it('undoes a shortcut conversion in one step', async () => {
    const t = create()
    await typeText(t.editor, '#')
    t.tick()
    await typeText(t.editor, ' ')
    t.tick()
    expect(t.editor.read(() => $isHeadingNode($getRoot().getFirstChild()))).toBe(true)
    t.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await settle()
    expect(t.editor.read(() => $isHeadingNode($getRoot().getFirstChild()))).toBe(false)
    expect(t.editor.read(() => $getRoot().getTextContent())).toBe('# ')
  })

  it('formats **bold** and `code` as it is typed', async () => {
    const t = create()
    await typeText(t.editor, 'a **b** `c` d')
    expect(t.markdown()).toBe('a **b** `c` d')
    expect(t.editor.read(() => $getRoot().getAllTextNodes().map((node) => node.getFormat()))).toEqual([0, 1, 0, 16, 0])
  })

  it('keeps the document readable after Enter', async () => {
    const t = create()
    await typeText(t.editor, '- a')
    await pressEnter(t.editor)
    await typeText(t.editor, 'b')
    expect(t.markdown()).toBe('- a\n- b')
  })
})
