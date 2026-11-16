import { getExtensionDependencyFromEditor } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_NORMAL,
  PASTE_COMMAND,
  UNDO_COMMAND,
  type ElementNode,
  type TextNode,
} from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorCore, type EditorCore, type EditorCoreOptions } from './core'
import { $exportMarkdown, $rootSeams, roundTrip, TRANSFORMERS } from './markdown'
import { $pasteMarkdown } from './placeholders'
import { $createImageNode, $isImageNode } from './nodes/image-node'

const TOKEN = '![uploading-00000000-0000-0000-0000-000000000000]()'

const open: EditorCore[] = []
afterEach(() => {
  for (const core of open.splice(0)) core.destroy()
  vi.useRealTimers()
})

function create(value: string, overrides: Partial<EditorCoreOptions> = {}) {
  const onChange = vi.fn<(markdown: string) => void>()
  const core = createEditorCore({
    value,
    readOnly: false,
    tasksToggleable: false,
    onChange,
    onPaste: () => {},
    onUnsupported: () => {},
    onEmptyChange: () => {},
    ...overrides,
  })
  open.push(core)
  // History is off without a window; the clock lets each step count as its own undo step.
  const history = getExtensionDependencyFromEditor(core.editor, HistoryExtension).output
  let clock = 0
  history.now.value = () => clock
  history.disabled.value = false
  return { core, onChange, tick: () => void (clock += 1000) }
}

const exported = (core: EditorCore): string => core.editor.read(() => $exportMarkdown(TRANSFORMERS, $rootSeams()))

const imageCount = (core: EditorCore): number => core.editor.read(() => countImages($getRoot()))

function countImages(parent: ElementNode): number {
  return parent.getChildren().reduce((n, child) => n + ($isImageNode(child) ? 1 : 'getChildren' in child ? countImages(child as ElementNode) : 0), 0)
}

/** Caret `offset` characters into the first text node of root child `child`. */
function placeCaret(core: EditorCore, child: number, offset: number): void {
  core.editor.update(
    () => {
      const text = ($getRoot().getChildAtIndex(child) as ElementNode).getFirstChild()
      if (!$isTextNode(text)) throw new Error('no text')
      text.select(offset, offset)
    },
    { discrete: true },
  )
}

const clearSelection = (core: EditorCore): void => core.editor.update(() => $setSelection(null), { discrete: true })

/** Types `text` at the selection the way the user would. */
const type = (core: EditorCore, text: string): void =>
  core.editor.update(
    () => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) selection.insertText(text)
    },
    { discrete: true },
  )

describe('insertText', () => {
  it('puts an image at the caret and the caret after it', () => {
    const { core, onChange } = create('abcd')
    placeCaret(core, 0, 2)
    core.insertText(TOKEN)
    expect(exported(core)).toBe(`ab${TOKEN}cd`)
    expect(imageCount(core)).toBe(1)
    type(core, 'X')
    expect(exported(core)).toBe(`ab${TOKEN}Xcd`)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('inserts at the end of the document without a selection', () => {
    const { core, onChange } = create('one\ntwo')
    clearSelection(core)
    core.insertText(TOKEN)
    expect(exported(core)).toBe(`one\ntwo${TOKEN}`)
    expect(onChange).toHaveBeenCalledTimes(1)
    type(core, 'X')
    expect(exported(core)).toBe(`one\ntwo${TOKEN}X`)
  })

  it('starts a paragraph after a last block that cannot hold an image', () => {
    const { core } = create('# title\n---')
    clearSelection(core)
    core.insertText(TOKEN)
    expect(exported(core)).toBe(`# title\n---\n${TOKEN}`)
  })

  it('goes after a selected range and keeps it', () => {
    const { core } = create('abcdef')
    core.editor.update(
      () => {
        const text = ($getRoot().getFirstChild() as ElementNode).getFirstChild()
        if ($isTextNode(text)) text.select(1, 3)
      },
      { discrete: true },
    )
    core.insertText(TOKEN)
    expect(exported(core)).toBe(`abc${TOKEN}def`)
  })

  it('emits one change and is one undo step', () => {
    const { core, onChange, tick } = create('abcd')
    placeCaret(core, 0, 2)
    tick()
    onChange.mockClear()
    core.insertText(TOKEN)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(`ab${TOKEN}cd`)
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('abcd')
  })

  it('is its own undo step even right after typing', () => {
    const { core } = create('abcd')
    placeCaret(core, 0, 2)
    type(core, 'X')
    core.insertText(TOKEN)
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('abXcd')
  })

  it('inserts the text as it is inside a code block', () => {
    const { core } = create('```\nab\n```')
    core.editor.update(
      () => {
        const text = ($getRoot().getFirstChild() as ElementNode).getFirstChild()
        if ($isTextNode(text)) text.select(1, 1)
      },
      { discrete: true },
    )
    core.insertText(TOKEN)
    expect(exported(core)).toBe(`\`\`\`\na${TOKEN}b\n\`\`\``)
    expect(imageCount(core)).toBe(0)
    expect(core.replaceText(TOKEN, '![](/img/x)')).toBe(true)
    expect(exported(core)).toBe('```\na![](/img/x)b\n```')
    expect(imageCount(core)).toBe(0)
  })
})

describe('replaceText', () => {
  it('replaces the placeholder with the markdown', () => {
    const { core, onChange } = create(`see ${TOKEN} here`)
    onChange.mockClear()
    expect(core.replaceText(TOKEN, '![](/img/x)')).toBe(true)
    expect(exported(core)).toBe('see ![](/img/x) here')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('see ![](/img/x) here')
  })

  it('keeps the caret after the replaced image', () => {
    const { core } = create('abcd')
    placeCaret(core, 0, 2)
    core.insertText(TOKEN)
    core.replaceText(TOKEN, '![](/img/x)')
    type(core, 'X')
    expect(exported(core)).toBe('ab![](/img/x)Xcd')
  })

  it('removes the placeholder for an empty replacement', () => {
    const { core, onChange } = create(`a ${TOKEN}b`)
    expect(core.replaceText(TOKEN, '')).toBe(true)
    expect(exported(core)).toBe('a b')
    expect(onChange).toHaveBeenCalledWith('a b')
  })

  it('returns false and commits nothing when the placeholder is gone', () => {
    const { core, onChange } = create('nothing here')
    const before = core.editor.getEditorState()
    expect(core.replaceText(TOKEN, '![](/img/x)')).toBe(false)
    expect(core.editor.getEditorState()).toBe(before)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('replaces only the first of two equal placeholders', () => {
    const { core } = create(`${TOKEN}\n${TOKEN}`)
    core.replaceText(TOKEN, '![](/img/x)')
    expect(exported(core)).toBe(`![](/img/x)\n${TOKEN}`)
  })

  it('replaces a placeholder inside a list item and a table cell', () => {
    const { core } = create(`- a ${TOKEN}\n\n| h |\n| --- |\n| ${TOKEN} |`)
    core.replaceText(TOKEN, '![](/img/x)')
    core.replaceText(TOKEN, '![](/img/y)')
    expect(exported(core)).toBe('- a ![](/img/x)\n\n| h |\n| --- |\n| ![](/img/y) |')
  })

  it('splits a block result at the placeholder', () => {
    const { core } = create(`a ${TOKEN} b`)
    expect(core.replaceText(TOKEN, 'x\ny')).toBe(true)
    expect(exported(core)).toBe('a x\ny b')
  })

})

describe('during a composition', () => {
  it('queues the replacement, returns true, and applies it after the flush', async () => {
    vi.useFakeTimers()
    const { core, onChange } = create(`a ${TOKEN}`)
    core.gate.begin()
    expect(core.replaceText(TOKEN, '![](/img/x)')).toBe(true)
    expect(exported(core)).toBe(`a ${TOKEN}`)
    expect(onChange).not.toHaveBeenCalled()
    core.gate.end()
    await vi.runAllTimersAsync()
    expect(exported(core)).toBe('a ![](/img/x)')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('returns false for a placeholder that is not there, without queuing anything', async () => {
    vi.useFakeTimers()
    const { core, onChange } = create('a')
    core.gate.begin()
    expect(core.replaceText(TOKEN, '![](/img/x)')).toBe(false)
    core.gate.end()
    await vi.runAllTimersAsync()
    expect(exported(core)).toBe('a')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does nothing at the flush when the user deleted the placeholder meanwhile', async () => {
    vi.useFakeTimers()
    const { core, onChange } = create(`a ${TOKEN}`)
    core.gate.begin()
    expect(core.replaceText(TOKEN, '![](/img/x)')).toBe(true)
    core.editor.update(() => $getRoot().clear(), { discrete: true })
    onChange.mockClear()
    core.gate.end()
    await vi.runAllTimersAsync()
    expect(exported(core)).toBe('')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('returns true for a placeholder whose replacement waits behind a pending flush', async () => {
    vi.useFakeTimers()
    const { core } = create(`a ${TOKEN}\n${TOKEN}`)
    core.gate.begin()
    core.replaceText(TOKEN, '![](/img/x)')
    core.gate.end()
    // The flush is scheduled but has not run: the second call queues behind the first.
    expect(core.replaceText(TOKEN, '![](/img/y)')).toBe(true)
    await vi.runAllTimersAsync()
    expect(exported(core)).toBe('a ![](/img/x)\n![](/img/y)')
  })

  it('applies a replacement queued behind its own queued insert, although the call returns false', async () => {
    vi.useFakeTimers()
    const { core } = create('abcd')
    placeCaret(core, 0, 2)
    core.gate.begin()
    core.insertText(TOKEN)
    // The placeholder is not in the document yet, so the caller falls back to its own text.
    expect(core.replaceText(TOKEN, '![](/img/x)')).toBe(false)
    core.gate.end()
    await vi.runAllTimersAsync()
    expect(exported(core)).toBe('ab![](/img/x)cd')
  })

  it('applies a queued replacement when the editor is destroyed', () => {
    const { core, onChange } = create(`a ${TOKEN}`)
    open.splice(open.indexOf(core), 1)
    core.gate.begin()
    expect(core.replaceText(TOKEN, '![](/img/x)')).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    core.destroy()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('a ![](/img/x)')
  })

  it('applies a queued removal when the editor is destroyed', () => {
    const { core, onChange } = create(`a ${TOKEN}`)
    open.splice(open.indexOf(core), 1)
    core.gate.begin()
    core.replaceText(TOKEN, '')
    core.destroy()
    expect(onChange).toHaveBeenCalledWith('a ')
  })

  it('applies an insert and its replacement in order when the editor is destroyed', () => {
    const { core, onChange } = create('abcd')
    open.splice(open.indexOf(core), 1)
    placeCaret(core, 0, 2)
    core.gate.begin()
    core.insertText(TOKEN)
    core.destroy()
    expect(onChange).toHaveBeenLastCalledWith(`ab${TOKEN}cd`)
  })

  it('does not apply what ran already a second time when destroyed', async () => {
    vi.useFakeTimers()
    const { core, onChange } = create(`a ${TOKEN}`)
    open.splice(open.indexOf(core), 1)
    core.gate.begin()
    core.replaceText(TOKEN, '![](/img/x)')
    core.gate.end()
    await vi.runAllTimersAsync()
    onChange.mockClear()
    core.destroy()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('paste', () => {
  const pasteEvent = () => {
    const event = { defaultPrevented: false, preventDefault: () => void (event.defaultPrevented = true) }
    return event
  }

  it('lets the callback take an image: one image, one change, no default handling', () => {
    let core!: EditorCore
    const onPaste = vi.fn((event: ClipboardEvent) => {
      event.preventDefault()
      core.insertText(TOKEN)
    })
    const created = create('abcd', { onPaste })
    core = created.core
    placeCaret(core, 0, 2)
    created.onChange.mockClear()
    const handled = core.editor.dispatchCommand(PASTE_COMMAND, pasteEvent() as unknown as ClipboardEvent)
    expect(handled).toBe(true)
    expect(onPaste).toHaveBeenCalledTimes(1)
    expect(exported(core)).toBe(`ab${TOKEN}cd`)
    expect(imageCount(core)).toBe(1)
    expect(created.onChange).toHaveBeenCalledTimes(1)
    type(core, 'X')
    expect(exported(core)).toBe(`ab${TOKEN}Xcd`)
  })
})

describe('image target', () => {
  const reloaded = (markdown: string) => roundTrip(markdown) === markdown

  it('drops `]` from the alt so the export reads back as the same image', () => {
    const { core } = create('')
    core.editor.update(() => ($getRoot().getFirstChild() as ElementNode).append($createImageNode('/img/x', 'a]c')), { discrete: true })
    expect(exported(core)).toBe('![ac](/img/x)')
    expect(reloaded(exported(core))).toBe(true)
  })

  it('percent-encodes whitespace and parentheses in the target', () => {
    const { core } = create('')
    core.editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild() as ElementNode
        paragraph.append($createImageNode('b c(d)\te', 'a'))
      },
      { discrete: true },
    )
    expect(exported(core)).toBe('![a](b%20c%28d%29%09e)')
    expect(reloaded(exported(core))).toBe(true)
  })

  it('keeps the escapes and `<` of a target that the importer accepts', () => {
    expect(roundTrip('![a](x\\(y\\))')).toBe('![a](x\\(y\\))')
    expect(roundTrip('![a](<x>)')).toBe('![a](x)')
  })

  it.each(['![a]c](b)', '![a](b c)'])('keeps what insertText and replaceText read from %s stable', (markdown) => {
    const { core } = create(`a ${TOKEN}`)
    core.insertText(markdown)
    core.replaceText(TOKEN, markdown)
    const once = exported(core)
    expect(roundTrip(once)).toBe(once)
  })
})

describe('plain-text paste', () => {
  const clipboardEvent = (data: Record<string, string>) => {
    const event = {
      defaultPrevented: false,
      preventDefault: () => void (event.defaultPrevented = true),
      clipboardData: { getData: (type: string) => data[type] ?? '' },
    }
    return event as unknown as ClipboardEvent
  }
  const paste = (core: EditorCore, text: string): boolean => core.editor.dispatchCommand(PASTE_COMMAND, clipboardEvent({ 'text/plain': text }))
  /** A new editor whose caret is at the end of its content, as in a focused editor. */
  const createWithCaret = (value: string) => {
    const created = create(value)
    created.core.editor.update(() => void $getRoot().selectEnd(), { discrete: true })
    created.onChange.mockClear()
    return created
  }
  const caret = (core: EditorCore) =>
    core.editor.read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) throw new Error('no caret')
      const node = selection.anchor.getNode()
      return { text: node.getTextContent(), offset: selection.anchor.offset, block: node.getTopLevelElementOrThrow().getTextContent() }
    })

  /** What `onChange` last received, i.e. what would be saved. The read commits a pending update first. */
  const saved = (core: EditorCore, onChange: ReturnType<typeof create>['onChange']): string | undefined => {
    core.editor.read(() => undefined)
    return onChange.mock.lastCall?.[0]
  }
  const types = (core: EditorCore): string[] => core.editor.read(() => $getRoot().getChildren().map((child) => child.getType()))

  it('reads markdown into blocks', () => {
    const { core, onChange } = createWithCaret('')
    expect(paste(core, '**a**\r\nb')).toBe(true)
    expect(saved(core, onChange)).toBe('**a**\nb')
    expect(types(core)).toEqual(['paragraph', 'paragraph'])
    expect(core.editor.read(() => ($getRoot().getFirstChild() as ElementNode).getFirstChild()?.getTextContent())).toBe('a')
    expect(core.editor.read(() => (($getRoot().getFirstChild() as ElementNode).getFirstChild() as TextNode).hasFormat('bold'))).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('turns headings and lists into blocks', () => {
    const { core, onChange } = createWithCaret('')
    paste(core, '# h\n- a\n- b')
    expect(types(core)).toEqual(['heading', 'list'])
    expect(saved(core, onChange)).toBe('# h\n- a\n- b')
  })

  it('inserts the text literally inside a code block, with LF', () => {
    const { core, onChange } = create('```\nx\n```')
    core.editor.update(() => void ($getRoot().getFirstChild() as ElementNode).selectEnd(), { discrete: true })
    onChange.mockClear()
    expect(paste(core, '**a**\r\nb\n# c')).toBe(true)
    expect(saved(core, onChange)).toBe('```\nx**a**\nb\n# c\n```')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(types(core)).toEqual(['code'])
  })

  it('does not add a block for a trailing line break', () => {
    const { core, onChange } = createWithCaret('')
    paste(core, 'a\n')
    expect(saved(core, onChange)).toBe('a')
    expect(types(core)).toEqual(['paragraph'])
  })

  it('leaves no CR in what is saved', () => {
    const { core, onChange } = createWithCaret('')
    paste(core, 'a\r\nb\rc\r\n\r\n# d\r\n')
    expect(saved(core, onChange)).not.toContain('\r')
  })

  it('is its own undo step, apart from the typing before it', () => {
    const { core } = create('abcd')
    placeCaret(core, 0, 2)
    type(core, 'X')
    paste(core, '# h\n- a')
    expect(exported(core)).not.toBe('abXcd')
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('abXcd')
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('abcd')
  })

  it('emits once and leaves the caret after the pasted content', () => {
    const { core, onChange } = createWithCaret('')
    paste(core, '# h\n- a')
    expect(saved(core, onChange)).toBe('# h\n- a')
    expect(onChange).toHaveBeenCalledTimes(1)
    const { text, offset } = caret(core)
    expect(text).toBe('a')
    expect(offset).toBe(1)
    type(core, 'X')
    expect(exported(core)).toBe('# h\n- aX')
  })

  it('splits the paragraph around the caret for several lines', () => {
    const { core, onChange } = create('abcd')
    placeCaret(core, 0, 2)
    paste(core, 'x\ny')
    expect(saved(core, onChange)).toBe('abx\nycd')
    expect(caret(core)).toEqual({ text: 'ycd', offset: 1, block: 'ycd' })
  })

  it('merges the first block into the paragraph around the caret, as Lexical does for HTML', () => {
    const { core, onChange } = create('abcd')
    placeCaret(core, 0, 2)
    paste(core, '# h\n- a')
    expect(saved(core, onChange)).toBe('abh\n- a\n\ncd')
  })

  it('merges one line into the paragraph around the caret', () => {
    const { core, onChange } = create('abcd')
    placeCaret(core, 0, 2)
    paste(core, '**x** y')
    expect(types(core)).toEqual(['paragraph'])
    expect(saved(core, onChange)).toBe('ab**x** ycd')
    expect(caret(core).block).toBe('abx ycd')
    type(core, 'Z')
    expect(exported(core)).toBe('ab**x** yZcd')
  })

  it.each([' x ', ' ', 'x '])('keeps the edge spaces of one pasted line: %j', (text) => {
    const { core, onChange } = create('abcd')
    placeCaret(core, 0, 2)
    paste(core, text)
    expect(saved(core, onChange)).toBe(`ab${text}cd`)
  })

  it('replaces a selected range', () => {
    const { core } = create('abcd')
    core.editor.update(() => void (($getRoot().getFirstChild() as ElementNode).getFirstChild() as TextNode).select(1, 3), { discrete: true })
    paste(core, 'X')
    expect(exported(core)).toBe('aXd')
  })

  it('leaves clipboards with HTML or Lexical data, and table cells, to Lexical', () => {
    const { core } = create('a\n\n| h |\n| --- |\n| c |')
    const taken = (event: ClipboardEvent): boolean => {
      let result = false
      core.editor.update(() => void (result = $pasteMarkdown(event, TRANSFORMERS)), { discrete: true })
      return result
    }
    placeCaret(core, 0, 1)
    expect(taken(clipboardEvent({ 'text/plain': '# a', 'text/html': '<h1>a</h1>' }))).toBe(false)
    expect(taken(clipboardEvent({ 'text/plain': '# a', 'application/x-lexical-editor': '{}' }))).toBe(false)
    expect(taken(clipboardEvent({}))).toBe(false)
    expect(taken(clipboardEvent({ 'text/plain': '\r\n' }))).toBe(false)
    core.editor.update(() => void ($getRoot().getLastChild() as ElementNode).getFirstDescendant()!.selectStart(), { discrete: true })
    expect(taken(clipboardEvent({ 'text/plain': '# a' }))).toBe(false)
    expect(exported(core)).toBe('a\n\n| h |\n| --- |\n| c |')
  })

  it('does not read a clipboard while a composition is active', () => {
    const { core } = create('abcd')
    placeCaret(core, 0, 2)
    const event = clipboardEvent({ 'text/plain': '# h' })
    vi.spyOn(core.gate, 'active', 'get').mockReturnValue(true)
    // Stands in for Lexical's own handler, which needs a DOM.
    const fallback = vi.fn(() => true)
    core.editor.registerCommand(PASTE_COMMAND, fallback, COMMAND_PRIORITY_NORMAL)
    core.editor.dispatchCommand(PASTE_COMMAND, event)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })
})
