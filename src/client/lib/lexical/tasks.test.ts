import { getExtensionDependencyFromEditor } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { $isListItemNode } from '@lexical/list'
import { $getRoot, UNDO_COMMAND, type ElementNode, type NodeKey } from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorCore, type EditorCore } from './core'
import { $exportMarkdown, $rootSeams, TRANSFORMERS } from './markdown'
import { isCheckMarkHit, toggleTask } from './tasks'

const open: EditorCore[] = []
afterEach(() => {
  for (const core of open.splice(0)) core.destroy()
  vi.useRealTimers()
})

function create(value: string, readOnly = true) {
  const onChange = vi.fn<(markdown: string) => void>()
  const core = createEditorCore({
    value,
    readOnly,
    tasksToggleable: true,
    onChange,
    onPaste: () => {},
    onUnsupported: () => {},
    onEmptyChange: () => {},
  })
  open.push(core)
  const history = getExtensionDependencyFromEditor(core.editor, HistoryExtension).output
  history.now.value = () => 0
  history.disabled.value = false
  return { core, onChange }
}

const exported = (core: EditorCore): string => core.editor.read(() => $exportMarkdown(TRANSFORMERS, $rootSeams()))

/** Key of the nth list item in document order, nested ones included. */
function itemKey(core: EditorCore, index: number): NodeKey {
  return core.editor.read(() => {
    const items: NodeKey[] = []
    const walk = (parent: ElementNode): void => {
      for (const child of parent.getChildren()) {
        if ($isListItemNode(child)) items.push(child.getKey())
        if ('getChildren' in child) walk(child as ElementNode)
      }
    }
    walk($getRoot())
    return items[index]!
  })
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe('toggleTask', () => {
  it('flips the item while the editor is not editable and emits one change', async () => {
    const { core, onChange } = create('- [ ] a\n- [x] b')
    expect(core.editor.isEditable()).toBe(false)
    toggleTask(core.editor, core.gate, itemKey(core, 0))
    await flush()
    expect(exported(core)).toBe('- [x] a\n- [x] b')
    expect(onChange.mock.calls).toEqual([['- [x] a\n- [x] b']])
    toggleTask(core.editor, core.gate, itemKey(core, 1))
    await flush()
    expect(exported(core)).toBe('- [x] a\n- [ ] b')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('is one undo step', async () => {
    const { core } = create('- [ ] a\n- [ ] b')
    // The first change only sets the history baseline, so there is something to undo to after the second.
    toggleTask(core.editor, core.gate, itemKey(core, 0))
    await flush()
    toggleTask(core.editor, core.gate, itemKey(core, 1))
    await flush()
    expect(exported(core)).toBe('- [x] a\n- [x] b')
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('- [x] a\n- [ ] b')
  })

  it('toggles a nested task', async () => {
    const { core } = create('- [ ] a\n    - [ ] b')
    toggleTask(core.editor, core.gate, itemKey(core, 2))
    await flush()
    expect(exported(core)).toBe('- [ ] a\n    - [x] b')
  })

  it('leaves an item that is not in a check list alone', async () => {
    const { core, onChange } = create('- a\n- b')
    toggleTask(core.editor, core.gate, itemKey(core, 0))
    await flush()
    expect(exported(core)).toBe('- a\n- b')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('waits for the gate and applies after it ends', async () => {
    vi.useFakeTimers()
    const { core, onChange } = create('- [ ] a')
    core.gate.begin()
    toggleTask(core.editor, core.gate, itemKey(core, 0))
    await vi.runAllTimersAsync()
    expect(exported(core)).toBe('- [ ] a')
    expect(onChange).not.toHaveBeenCalled()
    core.gate.end()
    await vi.runAllTimersAsync()
    expect(exported(core)).toBe('- [x] a')
    expect(onChange.mock.calls).toEqual([['- [x] a']])
  })
})

describe('isCheckMarkHit', () => {
  const base = { left: 100, right: 400, markerWidth: 13, rtl: false, touch: false, zoom: 1 }

  it('is true just inside the mark and false just outside', () => {
    expect(isCheckMarkHit({ ...base, clientX: 100.5 })).toBe(true)
    expect(isCheckMarkHit({ ...base, clientX: 112.5 })).toBe(true)
    expect(isCheckMarkHit({ ...base, clientX: 100 })).toBe(false)
    expect(isCheckMarkHit({ ...base, clientX: 113 })).toBe(false)
  })

  it('reaches 31 px beyond the mark for touch only', () => {
    expect(isCheckMarkHit({ ...base, clientX: 69, touch: true })).toBe(true)
    expect(isCheckMarkHit({ ...base, clientX: 143, touch: true })).toBe(true)
    expect(isCheckMarkHit({ ...base, clientX: 68, touch: true })).toBe(false)
    expect(isCheckMarkHit({ ...base, clientX: 145, touch: true })).toBe(false)
    expect(isCheckMarkHit({ ...base, clientX: 99 })).toBe(false)
    expect(isCheckMarkHit({ ...base, clientX: 120 })).toBe(false)
  })

  it('mirrors on the right edge for rtl', () => {
    const rtl = { ...base, rtl: true }
    expect(isCheckMarkHit({ ...rtl, clientX: 399.5 })).toBe(true)
    expect(isCheckMarkHit({ ...rtl, clientX: 387.5 })).toBe(true)
    expect(isCheckMarkHit({ ...rtl, clientX: 400 })).toBe(false)
    expect(isCheckMarkHit({ ...rtl, clientX: 387 })).toBe(false)
    expect(isCheckMarkHit({ ...rtl, clientX: 110 })).toBe(false)
    expect(isCheckMarkHit({ ...rtl, clientX: 431, touch: true })).toBe(true)
    expect(isCheckMarkHit({ ...rtl, clientX: 432, touch: true })).toBe(false)
  })

  it('divides clientX by the zoom', () => {
    expect(isCheckMarkHit({ ...base, clientX: 220, zoom: 2 })).toBe(true)
    expect(isCheckMarkHit({ ...base, clientX: 110, zoom: 2 })).toBe(false)
    expect(isCheckMarkHit({ ...base, clientX: 110, zoom: 1 })).toBe(true)
  })
})
