import type { ListNode } from '@lexical/list'
import { $isQuoteNode } from '@lexical/rich-text'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  INSERT_LINE_BREAK_COMMAND,
  IS_APPLE,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  LineBreakNode,
  type TextNode,
  UNDO_COMMAND,
} from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorCore, type EditorCore } from './core'
import { $exportMarkdown, $rootSeams, roundTrip, TRANSFORMERS } from './markdown'
import { createTestEditor, pressEnter, settle, type TestEditor, typeText } from './test-editor'

const open: Array<{ dispose(): void }> = []
afterEach(() => {
  for (const item of open.splice(0)) item.dispose()
})

function create(value: string) {
  const onChange = vi.fn<(markdown: string) => void>()
  const core: EditorCore = createEditorCore({
    value,
    readOnly: false,
    tasksToggleable: false,
    onChange,
    onPaste: () => {},
    onUnsupported: () => {},
    onEmptyChange: () => {},
  })
  open.push({ dispose: () => core.destroy() })
  return { core, onChange }
}

const exported = (core: EditorCore): string => core.editor.read(() => $exportMarkdown(TRANSFORMERS, core.editor.read($rootSeams)))

/** Puts the caret after `offset` characters of the text node whose content is `text`. */
function caret(core: EditorCore, text: string, offset: number): void {
  core.editor.update(
    () => {
      const node = $getRoot()
        .getAllTextNodes()
        .find((candidate) => candidate.getTextContent() === text)!
      node.select(offset, offset)
    },
    { discrete: true },
  )
}

/** Inserts `text` at the caret of a core, like typing. */
async function typeInto(core: EditorCore, text: string): Promise<void> {
  core.editor.update(
    () => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) selection.insertText(text)
    },
    { discrete: true },
  )
  await settle()
}

describe('Shift+Enter', () => {
  // The command is what Shift+Enter and Ctrl+O dispatch.
  const lineBreak = async (core: EditorCore) => {
    core.editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false)
    await settle()
  }

  // The block splits as Enter does, and no LineBreakNode ends up in it.
  it.each([
    ['a heading', '# ab', '# a\n# b'],
    ['a list item', '- ab', '- a\n- b'],
    ['a check list item', '- [ ] ab', '- [ ] a\n- [ ] b'],
    ['an ordered list item', '1. ab', '1. a\n2. b'],
  ])('splits %s like Enter', async (_name, markdown, expected) => {
    const { core, onChange } = create(markdown)
    caret(core, 'ab', 1)
    await lineBreak(core)
    expect(onChange.mock.calls).toEqual([[expected]])
    expect(exported(core)).toBe(expected)
    expect(core.editor.read(() => $nodesOfType(LineBreakNode).length)).toBe(0)

    const enter = create(markdown)
    caret(enter.core, 'ab', 1)
    enter.core.editor.dispatchCommand(KEY_ENTER_COMMAND, null)
    await settle()
    expect(exported(core)).toBe(exported(enter.core))
  })

  it('starts a new item at the end of a list item', async () => {
    const { core } = create('- ab')
    caret(core, 'ab', 2)
    await lineBreak(core)
    await typeInto(core, 'c')
    expect(exported(core)).toBe('- ab\n- c')
  })

  it('ends a heading with a paragraph at its end', async () => {
    const { core } = create('# ab')
    caret(core, 'ab', 2)
    await lineBreak(core)
    expect(core.editor.read(() => $getRoot().getChildren().map((child) => child.getType()))).toEqual(['heading', 'paragraph'])
  })

  it('splits when a range that ends in a heading starts elsewhere', async () => {
    const { core } = create('ab\n# cd')
    core.editor.update(
      () => {
        const [plain, heading] = $getRoot().getAllTextNodes() as [TextNode, TextNode]
        const selection = heading.select(1, 1)
        selection.anchor.set(plain.getKey(), 1, 'text')
      },
      { discrete: true },
    )
    await lineBreak(core)
    expect(core.editor.read(() => $nodesOfType(LineBreakNode).length)).toBe(0)
  })

  it('inserts a line break in a paragraph', async () => {
    const { core, onChange } = create('ab')
    caret(core, 'ab', 1)
    await lineBreak(core)
    expect(onChange.mock.calls).toEqual([['a\nb']])
    expect(exported(core)).toBe('a\nb')
  })

  it('keeps a quote together', async () => {
    const { core, onChange } = create('> ab')
    caret(core, 'ab', 1)
    await lineBreak(core)
    expect(onChange.mock.calls).toEqual([['> a\n> b']])
    const markdown = exported(core)
    expect(roundTrip(markdown)).toBe(markdown)
    const reloaded = create(markdown).core.editor
    expect(reloaded.read(() => $getRoot().getChildren().map((child) => $isQuoteNode(child)))).toEqual([true])
  })

  it('writes <br> in a table cell', async () => {
    const { core, onChange } = create('| x | y |\n| --- | --- |\n| ab | cd |')
    caret(core, 'ab', 1)
    await lineBreak(core)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(exported(core)).toContain('a<br>b')
  })

  it('is a newline in a code block', async () => {
    const { core } = create('```\nab\n```')
    caret(core, 'ab', 1)
    await lineBreak(core)
    expect(exported(core)).toBe('```\na\nb\n```')
  })
})

describe('format keys', () => {
  const create2 = (markdown: string): TestEditor => {
    const t = createTestEditor(markdown)
    open.push(t.editor)
    t.editor.update(() => void $getRoot().getAllTextNodes()[0]!.select(0, 3), { discrete: true })
    return t
  }
  // Headless runs as a non-Apple platform, where Mod is Ctrl.
  const press = (t: TestEditor, key: string, modifiers: { shiftKey?: boolean; altKey?: boolean; mod?: boolean } = { mod: true }) => {
    const preventDefault = vi.fn()
    const event = {
      key,
      shiftKey: modifiers.shiftKey ?? false,
      altKey: modifiers.altKey ?? false,
      metaKey: (modifiers.mod ?? false) && IS_APPLE,
      ctrlKey: (modifiers.mod ?? false) && !IS_APPLE,
      preventDefault,
    } as unknown as KeyboardEvent
    t.editor.dispatchCommand(KEY_DOWN_COMMAND, event)
    return preventDefault
  }

  it.each([
    ['b', {}, '**abc**'],
    ['i', {}, '*abc*'],
    ['e', {}, '`abc`'],
    ['X', { shiftKey: true }, '~~abc~~'],
  ])('Mod-%s formats the selection', (key, modifiers, expected) => {
    const t = create2('abc')
    press(t, key, { mod: true, ...modifiers })
    expect(t.markdown()).toBe(expected)
  })

  it('claims Mod-e and Mod-Shift-x so the browser does not act on them', () => {
    const t = create2('abc')
    expect(press(t, 'e')).toHaveBeenCalledTimes(1)
    expect(press(t, 'X', { mod: true, shiftKey: true })).toHaveBeenCalledTimes(1)
  })

  it('ignores the keys without Mod or with other modifiers', () => {
    const t = create2('abc')
    expect(press(t, 'e', { mod: false })).not.toHaveBeenCalled()
    expect(press(t, 'e', { mod: true, altKey: true })).not.toHaveBeenCalled()
    expect(press(t, 'e', { mod: true, shiftKey: true })).not.toHaveBeenCalled()
    expect(press(t, 'x', { mod: true })).not.toHaveBeenCalled()
    expect(t.markdown()).toBe('abc')
  })

  it('does not underline with Mod-u', () => {
    const t = create2('abc')
    press(t, 'u')
    expect(t.markdown()).toBe('abc')
    expect(t.editor.read(() => $getRoot().getAllTextNodes()[0]!.getFormat())).toBe(0)
  })

  it('does not format text in a code block', () => {
    const t = create2('```\nabc\n```')
    press(t, 'b')
    expect(t.editor.read(() => $getRoot().getAllTextNodes()[0]!.getFormat())).toBe(0)
  })
})

// Each case types the line into an empty document, one character per update.
describe('typed shortcuts', () => {
  const typed = async (text: string): Promise<{ markdown: string; types: string[] }> => {
    const t = createTestEditor()
    open.push(t.editor)
    await typeText(t.editor, text)
    return { markdown: t.markdown(), types: t.editor.read(() => $getRoot().getChildren().map((child) => child.getType())) }
  }

  it.each([
    ['## ', 'h', '## h', 'heading'],
    ['> ', 'q', '> q', 'quote'],
    ['- ', 'a', '- a', 'list'],
    ['1. ', 'a', '1. a', 'list'],
    ['[ ] ', 'a', '- [ ] a', 'list'],
    ['``` ', 'x', '```\nx\n```', 'code'],
    ['~~~ ', 'x', '```\nx\n```', 'code'],
    ['--- ', 'x', '---\nx', 'horizontalrule'],
  ])('%j becomes a block that exports as typed or in the canonical spelling', async (input, tail, markdown, type) => {
    const result = await typed(input + tail)
    expect(result.markdown).toBe(markdown)
    expect(result.types[0]).toBe(type)
    expect(roundTrip(result.markdown)).toBe(result.markdown)
  })

  // Spellings that only the importer reads.
  it.each([
    ['>x ', '\\>x '],
    ['####### ', '####### '],
    ['| a | ', '| a | '],
  ])('%j stays text', async (input, markdown) => {
    const result = await typed(input)
    expect(result.types).toEqual(['paragraph'])
    expect(result.markdown).toBe(markdown)
  })

  it('does not open a quote for a lone ">" followed by Enter', async () => {
    const t = createTestEditor()
    open.push(t.editor)
    await typeText(t.editor, '>')
    await pressEnter(t.editor)
    expect(t.editor.read(() => $getRoot().getChildren().map((child) => child.getType()))).toEqual(['paragraph', 'paragraph'])
  })

  it.each([
    ['- [ ] ', '- [ ] a'],
    ['- [x] ', '- [x] a'],
    ['- [X] ', '- [x] a'],
    ['- [] ', '- [ ] a'],
    ['* [ ] ', '* [ ] a'],
    ['+ [ ] ', '+ [ ] a'],
  ])('%j makes a check item', async (input, markdown) => {
    const result = await typed(`${input}a`)
    expect(result).toEqual({ markdown, types: ['list'] })
    expect(roundTrip(result.markdown)).toBe(result.markdown)
  })

  /** Loads `markdown`, puts the caret after `text`, presses Enter, and types `typedText`. */
  const typeAfterEnter = async (markdown: string, text: string, typedText: string): Promise<TestEditor> => {
    const t = createTestEditor(markdown)
    open.push(t.editor)
    t.editor.update(
      () => {
        const node = $getRoot()
          .getAllTextNodes()
          .find((candidate) => candidate.getTextContent() === text)!
        node.select(text.length, text.length)
      },
      { discrete: true },
    )
    await pressEnter(t.editor)
    await typeText(t.editor, typedText)
    return t
  }

  it('turns only the typed item into a check item', async () => {
    const t = await typeAfterEnter('- a\n- c', 'a', '[ ] b')
    // The lists are new neighbours, so they get blank lines (GFM would read them as one list).
    expect(t.markdown()).toBe('- a\n\n- [ ] b\n\n- c')
    expect(t.editor.read(() => $getRoot().getChildren().map((child) => (child as ListNode).getListType()))).toEqual(['bullet', 'check', 'bullet'])
  })

  it('converts the first and the last item of a list', async () => {
    const first = createTestEditor('- a\n- c')
    open.push(first.editor)
    first.editor.update(() => void $getRoot().getAllTextNodes()[0]!.select(0, 0), { discrete: true })
    await typeText(first.editor, '[ ] ')
    expect(first.markdown()).toBe('- [ ] a\n\n- c')
    expect(first.editor.read(() => $getRoot().getChildren().map((child) => (child as ListNode).getListType()))).toEqual(['check', 'bullet'])
    const last = await typeAfterEnter('- a\n- c', 'c', '[ ] d')
    expect(last.markdown()).toBe('- a\n- c\n\n- [ ] d')
    expect(last.editor.read(() => $getRoot().getChildren().map((child) => (child as ListNode).getListType()))).toEqual(['bullet', 'check'])
  })

  it('leaves a box typed in a check item as text', async () => {
    const t = await typeAfterEnter('- [ ] a', 'a', '[x] b')
    expect(t.markdown()).toBe('- [ ] a\n- [ ] [x] b')
  })

  it('undoes the conversion back to the typed text', async () => {
    const t = createTestEditor()
    open.push(t.editor)
    await typeText(t.editor, '- [ ]')
    t.tick()
    await typeText(t.editor, ' ')
    t.tick()
    expect(t.markdown()).toBe('- [ ] ')
    t.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await settle()
    expect(t.markdown()).toBe('- \\[ ] ')
  })

  it('leaves a nested item as text', async () => {
    const t = await typeAfterEnter('- a\n  - b\n  - c', 'b', '[ ] d')
    expect(t.markdown()).toBe('- a\n    - b\n    - \\[ ] d\n    - c')
  })

  it('does not convert a loaded literal box', async () => {
    const t = createTestEditor('- \\[ ] x')
    open.push(t.editor)
    expect(t.markdown()).toBe('- \\[ ] x')
    // A backspace: the caret ends right after the box, as when it was typed.
    t.editor.update(() => void $getRoot().getAllTextNodes()[0]!.spliceText(4, 1, '', true), { discrete: true })
    await settle()
    expect(t.markdown()).toBe('- \\[ ] ')
  })

  it('reads "1) " as an ordered list and writes it back as "1."', async () => {
    expect(await typed('1) a')).toEqual({ markdown: '1. a', types: ['list'] })
  })

  it('does not turn a typed card line into a card', async () => {
    const result = await typed('@[card](https://e.example) ')
    expect(result.types).toEqual(['paragraph'])
  })

  it('types an image line as a link after a literal "!"', async () => {
    const result = await typed('![a](/x.png)')
    expect(result.types).toEqual(['paragraph'])
    expect(result.markdown).toBe('\\![a](/x.png)')
  })
})
