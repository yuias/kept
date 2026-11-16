import { getExtensionDependencyFromEditor } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { $isAutoLinkNode } from '@lexical/link'
import {
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  KEY_ESCAPE_COMMAND,
  PASTE_COMMAND,
  UNDO_COMMAND,
  type ElementNode,
  type LexicalNode,
} from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorCore, type EditorCore, type EditorCoreOptions } from './core'
import { $exportMarkdown, $rootSeams, TRANSFORMERS } from './markdown'
import { $isCardNode } from './nodes/card-node'
import { $applyCardChoice, $detectUrlPaste, type PendingUrl } from './url-paste'

const URL = 'https://example.com/a?b=1'

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
  const events: Array<PendingUrl | null> = []
  core.urlPaste.subscribe((pending) => events.push(pending))
  return { core, onChange, events, tick: () => void (clock += 1000) }
}

const exported = (core: EditorCore): string => core.editor.read(() => $exportMarkdown(TRANSFORMERS, $rootSeams()))

const rootChild = (core: EditorCore, index: number): ElementNode => core.editor.read(() => $getRoot().getChildAtIndex(index) as ElementNode)

/** Caret in root child `index`. */
const caretIn = (core: EditorCore, index: number): void =>
  core.editor.update(() => void ($getRoot().getChildAtIndex(index) as ElementNode).select(0, 0), { discrete: true })

const clipboardEvent = (text: string) => {
  const event = {
    defaultPrevented: false,
    preventDefault: () => void (event.defaultPrevented = true),
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  }
  return event as unknown as ClipboardEvent
}

/** The URL decision alone, as the paste command runs it: inside an update. */
function pasteInUpdate(core: EditorCore, text: string): boolean {
  let taken = false
  core.editor.update(() => void (taken = core.urlPaste.paste(clipboardEvent(text))), { discrete: true })
  return taken
}

function detect(core: EditorCore, text: string): PendingUrl | null {
  let hit: PendingUrl | null = null
  core.editor.update(() => void (hit = $detectUrlPaste(text)), { discrete: true })
  return hit
}

const escape = (core: EditorCore) => {
  const event = { preventDefault: vi.fn() }
  const handled = core.editor.dispatchCommand(KEY_ESCAPE_COMMAND, event as unknown as KeyboardEvent)
  return { handled, event }
}

/** Where the caret is: the type and text of its block, the offset, and what sits before the block. */
const caretInfo = (core: EditorCore) =>
  core.editor.read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return undefined
    const block = selection.anchor.getNode().getTopLevelElementOrThrow()
    return { type: block.getType(), text: block.getTextContent(), offset: selection.anchor.offset, afterCard: $isCardNode(block.getPreviousSibling()) }
  })

describe('paste detection', () => {
  it('takes a lone URL in an empty paragraph: the text is inserted, linked, and one change is emitted', () => {
    const { core, onChange, events } = create('')
    caretIn(core, 0)
    onChange.mockClear()
    const event = clipboardEvent(`  ${URL}\n`)
    expect(core.editor.dispatchCommand(PASTE_COMMAND, event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(exported(core)).toBe(URL)
    expect(core.editor.read(() => $isAutoLinkNode(rootChild(core, 0).getFirstChild()))).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(URL)
    expect(core.urlPaste.pending).toEqual({ key: rootChild(core, 0).getKey(), url: URL })
    // Announced once, after the commit.
    expect(events).toEqual([core.urlPaste.pending])
  })

  it('leaves an image paste alone even when the clipboard text is a URL', () => {
    const { core, onChange, events } = create('', {
      onPaste: (event) => event.preventDefault(),
    })
    caretIn(core, 0)
    onChange.mockClear()
    expect(core.editor.dispatchCommand(PASTE_COMMAND, clipboardEvent(URL))).toBe(true)
    expect(exported(core)).toBe('')
    expect(onChange).not.toHaveBeenCalled()
    expect(core.urlPaste.pending).toBeNull()
    expect(events).toEqual([])
  })

  it('does not take anything that is not one http(s) URL', () => {
    const { core } = create('')
    caretIn(core, 0)
    for (const text of [
      'https://example.com/a b',
      'see https://example.com',
      'https://example.com\nhttps://example.com/2',
      'ftp://example.com/x',
      'mailto:a@example.com',
      'https://',
      'example.com',
      '',
    ]) {
      expect(detect(core, text), text).toBeNull()
      expect(pasteInUpdate(core, text), text).toBe(false)
    }
    expect(exported(core)).toBe('')
  })

  it('does not take a paste into a paragraph that has text', () => {
    const { core } = create('abc')
    caretIn(core, 0)
    expect(detect(core, URL)).toBeNull()
    expect(pasteInUpdate(core, URL)).toBe(false)
    expect(exported(core)).toBe('abc')
  })

  it('does not take a paste into a list item, a quote, or a code block', () => {
    for (const value of ['- a', '> a', '```\na\n```']) {
      const { core } = create(value)
      core.editor.update(
        () => {
          const block = $getRoot().getFirstChild() as ElementNode
          // Empty the innermost block, so only the container is what rules the paste out.
          let inner: LexicalNode = block
          while ('getFirstChild' in inner && (inner as ElementNode).getFirstChild()) inner = (inner as ElementNode).getFirstChild()!
          ;(inner.getParent() as ElementNode).clear().select(0, 0)
        },
        { discrete: true },
      )
      expect(detect(core, URL), value).toBeNull()
      expect(pasteInUpdate(core, URL), value).toBe(false)
    }
  })

  it('does not take a paste over a non-collapsed selection', () => {
    const { core } = create('a\n\nb')
    core.editor.update(
      () => {
        const selection = $createRangeSelection()
        selection.anchor.set($getRoot().getChildAtIndex(1)!.getKey(), 0, 'element')
        selection.focus.set($getRoot().getChildAtIndex(2)!.getKey(), 0, 'element')
        $setSelection(selection)
      },
      { discrete: true },
    )
    expect(detect(core, URL)).toBeNull()
  })

  it('does not take a paste without a selection, in a read-only note, or during a composition', () => {
    const { core } = create('')
    core.editor.update(() => $setSelection(null), { discrete: true })
    expect(pasteInUpdate(core, URL)).toBe(false)

    caretIn(core, 0)
    core.gate.begin()
    expect(pasteInUpdate(core, URL)).toBe(false)
    core.gate.end()

    core.editor.setEditable(false)
    expect(pasteInUpdate(core, URL)).toBe(false)
    expect(exported(core)).toBe('')
  })
})

describe('closing the choice', () => {
  const pasted = () => {
    const created = create('')
    caretIn(created.core, 0)
    created.core.editor.dispatchCommand(PASTE_COMMAND, clipboardEvent(URL))
    created.core.editor.read(() => {})
    expect(created.core.urlPaste.pending).not.toBeNull()
    created.events.length = 0
    return created
  }

  it('closes without a change when Link is chosen', () => {
    const { core, onChange, events } = pasted()
    onChange.mockClear()
    core.urlPaste.close()
    expect(core.urlPaste.pending).toBeNull()
    expect(events).toEqual([null])
    expect(exported(core)).toBe(URL)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('consumes Esc while open, and does not touch it otherwise', () => {
    const { core, events } = pasted()
    const open = escape(core)
    expect(open.handled).toBe(true)
    expect(open.event.preventDefault).toHaveBeenCalledTimes(1)
    expect(core.urlPaste.pending).toBeNull()
    expect(events).toEqual([null])

    const closed = escape(core)
    expect(closed.event.preventDefault).not.toHaveBeenCalled()
    expect(events).toEqual([null])
  })

  it('closes on any other edit', () => {
    const { core, events } = pasted()
    core.editor.update(
      () => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertText('x')
      },
      { discrete: true },
    )
    expect(core.urlPaste.pending).toBeNull()
    expect(events).toEqual([null])
  })

  it('closes when the caret leaves the paragraph', () => {
    const { core, events } = pasted()
    core.editor.update(() => void ($getRoot().append($createParagraphNode()).getLastChild() as ElementNode).select(0, 0), { discrete: true })
    expect(core.urlPaste.pending).toBeNull()
    expect(events).toEqual([null])
  })

  it('closes when the paste is undone', () => {
    const { core, tick } = pasted()
    tick()
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('')
    expect(core.urlPaste.pending).toBeNull()
  })

  it('closes when an external value replaces the document', async () => {
    vi.useFakeTimers()
    const { core, events } = pasted()
    core.setValue('other')
    await vi.runAllTimersAsync()
    expect(exported(core)).toBe('other')
    expect(core.urlPaste.pending).toBeNull()
    expect(events).toEqual([null])
  })

  it('closes when the note turns read-only', () => {
    const { core } = pasted()
    core.setReadOnly(true, false)
    expect(core.urlPaste.pending).toBeNull()
  })
})

describe('card choice', () => {
  const pasted = (value: string, index: number) => {
    const created = create(value)
    caretIn(created.core, index)
    created.core.editor.dispatchCommand(PASTE_COMMAND, clipboardEvent(URL))
    created.core.editor.read(() => {})
    created.tick()
    created.onChange.mockClear()
    return created
  }

  it('replaces the last paragraph with a card and puts the caret in a new paragraph', () => {
    const { core, onChange } = pasted('', 0)
    core.urlPaste.chooseCard()
    expect(core.urlPaste.pending).toBeNull()
    expect(core.editor.read(() => $getRoot().getChildren().map((node) => node.getType()))).toEqual(['kept-card', 'paragraph'])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(`@[card](${URL})\n`)
    expect(caretInfo(core)).toEqual({ type: 'paragraph', text: '', offset: 0, afterCard: true })
  })

  it('joins the card to the paragraphs around it with a single line feed', () => {
    const { core, onChange } = pasted('a\n\nb', 1)
    core.urlPaste.chooseCard()
    expect(core.editor.read(() => $getRoot().getChildren().map((node) => node.getType()))).toEqual(['paragraph', 'kept-card', 'paragraph'])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(`a\n@[card](${URL})\nb`)
    // The caret goes to the start of the paragraph that follows.
    expect(caretInfo(core)).toMatchObject({ text: 'b', offset: 0, afterCard: true })
  })

  it('makes a paragraph when the card is followed by something else', () => {
    const { core } = pasted('a\n\n---', 1)
    core.urlPaste.chooseCard()
    expect(core.editor.read(() => $getRoot().getChildren().map((node) => node.getType()))).toEqual(['paragraph', 'kept-card', 'paragraph', 'horizontalrule'])
    expect(caretInfo(core)).toMatchObject({ type: 'paragraph', text: '', afterCard: true })
  })

  it('is one undo step back to the plain URL, and Link leaves no card behind', () => {
    const { core } = pasted('', 0)
    core.urlPaste.chooseCard()
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe(URL)
  })

  it('applies nothing once the paragraph is no longer a URL', () => {
    const { core } = create('abc')
    let result: boolean | undefined
    core.editor.update(() => void (result = $applyCardChoice($getRoot().getFirstChild()!.getKey())), { discrete: true })
    expect(result).toBe(false)
    expect(exported(core)).toBe('abc')
  })

  it('waits for a composition to end', () => {
    vi.useFakeTimers()
    const { core, onChange } = pasted('', 0)
    core.gate.begin()
    core.urlPaste.chooseCard()
    expect(exported(core)).toBe(URL)
    expect(onChange).not.toHaveBeenCalled()
    core.gate.end()
    vi.runAllTimers()
    expect(exported(core)).toBe(`@[card](${URL})\n`)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
