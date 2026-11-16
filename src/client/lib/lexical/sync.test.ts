import { getExtensionDependencyFromEditor } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import type { Transformer } from '@lexical/markdown'
import { $findMatchingParent } from '@lexical/utils'
import { $isHeadingNode } from '@lexical/rich-text'
import type { ListNode } from '@lexical/list'
import { TableNode } from '@lexical/table'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  SKIP_DOM_SELECTION_TAG,
  $isTextNode,
  $setCompositionKey,
  UNDO_COMMAND,
  type LexicalNode,
  type RangeSelection,
} from 'lexical'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompositionGate } from './composition'
import { createEditorCore, EXTERNAL_TAG, type EditorCore, type EditorCoreOptions } from './core'
import { $exportMarkdown, $rootSeams, TRANSFORMERS } from './markdown'

const open: EditorCore[] = []
afterEach(() => {
  for (const core of open.splice(0)) core.destroy()
  vi.useRealTimers()
})

function create(value: string, overrides: Partial<EditorCoreOptions> = {}, transformers?: Transformer[]) {
  const onChange = vi.fn<(markdown: string) => void>()
  const onUnsupported = vi.fn<() => void>()
  const core = createEditorCore(
    {
      value,
      readOnly: false,
      tasksToggleable: false,
      onChange,
      onPaste: () => {},
      onUnsupported,
      onEmptyChange: () => {},
      ...overrides,
    },
    transformers,
  )
  open.push(core)
  // History is off without a window; the clock lets each step count as its own undo step.
  const history = getExtensionDependencyFromEditor(core.editor, HistoryExtension).output
  let clock = 0
  history.now.value = () => clock
  history.disabled.value = false
  return { core, onChange, onUnsupported, tick: () => void (clock += 1000) }
}

const exported = (core: EditorCore): string => core.editor.read(() => $exportMarkdown(TRANSFORMERS, $rootSeams()))

/** Puts the caret `offset` characters into the text node at `child` and commits it. */
function placeCaret(core: EditorCore, child: number, offset: number): void {
  core.editor.update(
    () => {
      const text = ($getRoot().getChildAtIndex(child) as unknown as { getFirstDescendant(): LexicalNode }).getFirstDescendant()
      if (!$isTextNode(text)) throw new Error('no text')
      text.select(offset, offset)
    },
    { discrete: true },
  )
}

/** Root child index and character offset of the caret, or null without a range selection. */
function caret(core: EditorCore): { child: number; offset: number } | null {
  return core.editor.read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return null
    const node = selection.anchor.getNode()
    // Not getTopLevelElement: a table cell is a shadow root and would stop there.
    const block = $findMatchingParent(node, (parent) => $isRootNode(parent.getParent()))!
    return { child: block.getIndexWithinParent(), offset: selection.anchor.offset }
  })
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('applyExternalValue', () => {
  it('does nothing for the value the document already exports', () => {
    const { core } = create('# title\nbody')
    const before = core.editor.getEditorState()
    core.setValue('# title\nbody')
    expect(core.editor.getEditorState()).toBe(before)
  })

  it('replaces the document without calling onChange', async () => {
    const { core, onChange } = create('one')
    core.setValue('# two\nthree')
    await settle()
    expect(exported(core)).toBe('# two\nthree')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the root child and the offset of the caret', () => {
    const { core } = create('first\nsecond line')
    placeCaret(core, 1, 6)
    core.setValue('FIRST\nsecond LINE\nthird')
    expect(caret(core)).toEqual({ child: 1, offset: 6 })
  })

  it('counts the offset over formatted and linked text', () => {
    const { core } = create('a **bold** and [link](https://e.example) end')
    // "a " + "bold" + " and " + "li" = 13 characters before the caret
    core.editor.update(
      () => {
        const link = $getRoot().getAllTextNodes().find((node) => node.getTextContent() === 'link')!
        link.select(2, 2)
      },
      { discrete: true },
    )
    core.setValue('x **bold** and [link](https://e.example) END')
    expect(core.editor.read(() => {
      const selection = $getSelection()
      return $isRangeSelection(selection) ? [selection.anchor.getNode().getTextContent(), selection.anchor.offset] : null
    })).toEqual(['link', 2])
  })

  it('clamps the caret to the new document', () => {
    const { core } = create('one\ntwo\nthree line')
    placeCaret(core, 2, 10)
    core.setValue('x\ny')
    expect(caret(core)).toEqual({ child: 1, offset: 1 })
  })

  it('clamps to an empty document', () => {
    const { core } = create('abc')
    placeCaret(core, 0, 2)
    core.setValue('')
    expect(exported(core)).toBe('')
    expect(caret(core)).toEqual({ child: 0, offset: 0 })
  })

  it('keeps the caret in a table cell by the index of the table', () => {
    const { core } = create('intro\n| a | b |\n| --- | --- |\n| one | two |')
    core.editor.update(
      () => {
        const cell = $getRoot().getAllTextNodes().find((node) => node.getTextContent() === 'two')!
        cell.select(2, 2)
      },
      { discrete: true },
    )
    expect(caret(core)).toEqual({ child: 1, offset: 2 })
    core.setValue('intro\n| a | b |\n| --- | --- |\n| one | twelve |')
    expect(caret(core)).toEqual({ child: 1, offset: 2 })
    expect(core.editor.read(() => $getSelection()?.getNodes()[0]?.getTextContent())).toBe('twelve')
  })

  it.each([
    ['list item', '- a\n- b', 'b', '- a\n- b\nmore'],
    ['task item', '- [ ] a\n- [ ] b', 'b', '- [ ] a\n- [ ] b\nmore'],
    ['table cell', '| h | i |\n| --- | --- |\n| a | b |', 'b', '| h | i |\n| --- | --- |\n| a | b |\nmore'],
  ])('keeps the caret at the start of the second %s', (_name, value, text, next) => {
    const { core } = create(value)
    core.editor.update(() => $getRoot().getAllTextNodes().find((node) => node.getTextContent() === text)!.select(0, 0), { discrete: true })
    core.setValue(next)
    core.editor.update(
      () => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertText('X')
      },
      { discrete: true },
    )
    expect(core.editor.read(() => $getRoot().getAllTextNodes().map((node) => node.getTextContent()))).toContain('Xb')
  })

  it('keeps the caret in an empty new list item', () => {
    const { core } = create('- a\n- ')
    core.editor.update(() => void ($getRoot().getFirstChild() as ListNode).getLastChild()!.selectStart(), { discrete: true })
    core.setValue('- a\n- \n- c')
    core.editor.update(() => void ($getSelection() as RangeSelection).insertText('X'), { discrete: true })
    expect(exported(core)).toBe('- a\n- X\n- c')
  })

  it('keeps the caret in the same item when an item is added after it', () => {
    const { core } = create('- a\n- b')
    core.editor.update(() => void ($getRoot().getAllTextNodes()[1]!.select(0, 0)), { discrete: true })
    core.setValue('- a\n- b\n- c')
    expect(core.editor.read(() => ($getSelection() as RangeSelection).anchor.getNode().getTextContent())).toBe('b')
  })

  it('does not move the DOM selection into an editor that is not focused', () => {
    const { core } = create('abc')
    placeCaret(core, 0, 1)
    const tags: Array<ReadonlySet<string>> = []
    core.editor.registerUpdateListener(({ tags: updateTags }) => tags.push(updateTags))
    vi.stubGlobal('document', { activeElement: {} })
    // Only the first lookup is faked: Lexical needs a real window for the rest.
    const getRoot = vi.spyOn(core.editor, 'getRootElement')
    getRoot.mockReturnValueOnce({ contains: () => false } as unknown as HTMLElement)
    core.setValue('xyz')
    getRoot.mockReturnValueOnce({ contains: () => true } as unknown as HTMLElement)
    core.setValue('uvw')
    vi.unstubAllGlobals()
    expect(tags.map((set) => set.has(SKIP_DOM_SELECTION_TAG))).toEqual([true, false])
  })

  it('puts the caret next to a block without text', () => {
    const { core } = create('abc\ndef')
    placeCaret(core, 1, 2)
    core.setValue('abc\n---\ndef')
    expect(caret(core)).not.toBeNull()
    expect(core.editor.read(() => $getRoot().getChildrenSize())).toBe(3)
  })

  it('does not invent a selection when there was none', () => {
    const { core } = create('abc')
    expect(caret(core)).toBeNull()
    core.setValue('xyz')
    expect(caret(core)).toBeNull()
  })

  it('clears the history', async () => {
    const { core, onChange, tick } = create('one')
    core.editor.update(() => void $getRoot().selectEnd().insertText('!'), { discrete: true })
    tick()
    core.editor.update(() => void $getRoot().selectEnd().insertText('?'), { discrete: true })
    await settle()
    core.setValue('two')
    onChange.mockClear()
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await settle()
    expect(exported(core)).toBe('two')
    expect(onChange).not.toHaveBeenCalled()

    // The first edit after the replace is an undo step again, and it goes back to the new value.
    tick()
    core.editor.update(() => void $getRoot().selectEnd().insertText('!'), { discrete: true })
    tick()
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await settle()
    expect(exported(core)).toBe('two')
  })

  it('uses the seams of the new document for the next edit', async () => {
    const { core, onChange } = create('plain')
    core.setValue('- a\nb')
    core.editor.update(() => void $getRoot().selectEnd().insertText('X'), { discrete: true })
    await settle()
    expect(onChange.mock.calls).toEqual([['- a\nbX']])
  })
})

describe('shortcuts and sync updates', () => {
  it('does not turn text behind the restored caret into a heading', async () => {
    const { core, onChange } = create('ab')
    placeCaret(core, 0, 2)
    core.setValue('\\# x')
    await settle()
    expect(core.editor.read(() => $isHeadingNode($getRoot().getFirstChild()))).toBe(false)
    expect(exported(core)).toBe('\\# x')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not turn a box into a task in an update tagged as external', async () => {
    const { core } = create('- \\[ ]')
    const typeSpace = (tag?: string) =>
      core.editor.update(
        () => {
          const text = $getRoot().getAllTextNodes()[0]!
          text.select(3, 3)
          text.spliceText(3, 0, ' ', true)
        },
        { discrete: true, tag },
      )
    core.editor.update(() => void $getRoot().getAllTextNodes()[0]!.select(3, 3), { discrete: true })
    const listType = () => core.editor.read(() => ($getRoot().getFirstChild() as ListNode).getListType())
    typeSpace(EXTERNAL_TAG)
    await settle()
    expect(listType()).toBe('bullet')
  })
})

describe('composition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('commits nothing while a composition is active, and applies the value after it ends', () => {
    const { core, onChange } = create('one')
    const before = core.editor.getEditorState()
    core.gate.begin()
    core.setValue('two')
    expect(core.editor.getEditorState()).toBe(before)
    vi.runAllTimers()
    expect(core.editor.getEditorState()).toBe(before)

    core.gate.end()
    expect(core.editor.getEditorState()).toBe(before)
    vi.runAllTimers()
    expect(exported(core)).toBe('two')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('also waits while Lexical itself reports a composition', () => {
    const { core } = create('one')
    core.editor.update(() => $setCompositionKey($getRoot().getAllTextNodes()[0]!.getKey()), { discrete: true })
    expect(core.editor.isComposing()).toBe(true)
    const before = core.editor.getEditorState()
    core.setValue('two')
    expect(core.editor.getEditorState()).toBe(before)

    core.editor.update(() => $setCompositionKey(null), { discrete: true })
    core.gate.begin()
    core.gate.end()
    vi.runAllTimers()
    expect(exported(core)).toBe('two')
  })

  it('applies queued values in order', () => {
    const { core } = create('one')
    core.gate.begin()
    core.setValue('two')
    core.setValue('three')
    core.gate.end()
    vi.runAllTimers()
    expect(exported(core)).toBe('three')
  })

  it('keeps the caret and runs the guard when the queued value is applied', () => {
    const { core, onUnsupported } = create('first\nsecond')
    placeCaret(core, 1, 3)
    core.gate.begin()
    core.setValue('FIRST\nSECOND')
    expect(caret(core)).toEqual({ child: 1, offset: 3 })
    core.gate.end()
    vi.runAllTimers()
    expect(caret(core)).toEqual({ child: 1, offset: 3 })
    expect(exported(core)).toBe('FIRST\nSECOND')
    expect(onUnsupported).not.toHaveBeenCalled()
  })

  it('runs the fidelity guard when the queued value is applied', async () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    const withoutTable = TRANSFORMERS.filter(
      (transformer) => !(transformer.type === 'multiline-element' && transformer.dependencies?.includes(TableNode)),
    )
    const { core, onUnsupported, onChange } = create('x', {}, withoutTable)
    core.gate.begin()
    core.setValue(table)
    expect(onUnsupported).not.toHaveBeenCalled()
    core.gate.end()
    vi.runAllTimers()
    expect(onUnsupported).toHaveBeenCalledTimes(1)
    core.editor.update(() => void $getRoot().selectEnd().insertText('!'), { discrete: true })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('drops a queued value when the user changed the text in the meantime', () => {
    const { core, onChange } = create('one')
    core.gate.begin()
    core.setValue('two')
    // Stands in for Lexical's own composition update, which the gate does not hold back.
    core.editor.update(() => void $getRoot().selectEnd().insertText('X'), { discrete: true })
    core.gate.end()
    vi.runAllTimers()
    expect(exported(core)).toBe('oneX')
    expect(onChange.mock.calls).toEqual([['oneX']])
    core.setValue('three')
    expect(exported(core)).toBe('three')
  })

  it('keeps a value queued after the user change', () => {
    const { core } = create('one')
    core.gate.begin()
    core.setValue('two')
    core.editor.update(() => void $getRoot().selectEnd().insertText('X'), { discrete: true })
    core.setValue('three')
    core.gate.end()
    vi.runAllTimers()
    expect(exported(core)).toBe('three')
  })

  it('does not flush when a new composition starts before the timer', () => {
    const { core } = create('one')
    core.gate.begin()
    core.setValue('two')
    core.gate.end()
    core.gate.begin()
    vi.runAllTimers()
    expect(exported(core)).toBe('one')
    core.gate.end()
    vi.runAllTimers()
    expect(exported(core)).toBe('two')
  })

  it('does not flush after destroy', () => {
    const { core } = create('one')
    core.gate.begin()
    core.setValue('two')
    core.gate.end()
    core.destroy()
    open.pop()
    vi.runAllTimers()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('CompositionGate', () => {
  const gate = () => {
    const { core } = create('')
    return new CompositionGate(core.editor)
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('runs an operation at once when idle', () => {
    const g = gate()
    const op = vi.fn()
    g.run(op)
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('queues operations while active and runs them in order on the macrotask after end', () => {
    const g = gate()
    const order: number[] = []
    g.begin()
    expect(g.active).toBe(true)
    g.run(() => order.push(1))
    g.run(() => order.push(2))
    g.end()
    expect(order).toEqual([])
    vi.runAllTimers()
    expect(order).toEqual([1, 2])
    expect(g.active).toBe(false)
  })

  it('puts a new operation behind the ones still waiting for the flush', () => {
    const g = gate()
    const order: number[] = []
    g.begin()
    g.run(() => order.push(1))
    g.end()
    g.run(() => order.push(2))
    expect(order).toEqual([])
    vi.runAllTimers()
    expect(order).toEqual([1, 2])
  })

  it('polls while Lexical still reports a composition, and only while operations wait', () => {
    const { core } = create('one')
    core.gate.begin()
    core.gate.end()
    expect(vi.getTimerCount()).toBe(0)

    core.editor.update(() => $setCompositionKey($getRoot().getAllTextNodes()[0]!.getKey()), { discrete: true })
    core.setValue('two')
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersToNextTimer()
    vi.advanceTimersToNextTimer()
    expect(exported(core)).toBe('one')
    expect(vi.getTimerCount()).toBe(1)

    core.editor.update(() => $setCompositionKey(null), { discrete: true })
    vi.advanceTimersToNextTimer()
    expect(exported(core)).toBe('two')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the remaining operations when one throws', () => {
    const g = gate()
    const order: number[] = []
    g.begin()
    g.run(() => {
      throw new Error('boom')
    })
    g.run(() => order.push(2))
    g.end()
    expect(() => vi.runAllTimers()).toThrow('boom')
    g.run(() => order.push(3))
    vi.runAllTimers()
    expect(order).toEqual([2, 3])
  })
})
