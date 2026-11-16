import { getExtensionDependencyFromEditor } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { $getNodeByKey, $getRoot, $getSelection, $isNodeSelection, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, UNDO_COMMAND, type NodeKey } from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { $setCardUrl, createCardOps, parseCardUrl } from './cards'
import { createEditorCore, type EditorCore } from './core'
import { $exportMarkdown, $rootSeams, TRANSFORMERS } from './markdown'
import { $isCardNode, type CardNode } from './nodes/card-node'

const open: EditorCore[] = []
afterEach(() => {
  for (const core of open.splice(0)) core.destroy()
  vi.useRealTimers()
})

function create(value: string) {
  const onChange = vi.fn<(markdown: string) => void>()
  const core = createEditorCore({
    value,
    readOnly: false,
    tasksToggleable: false,
    onChange,
    onPaste: () => {},
    onUnsupported: () => {},
    onEmptyChange: () => {},
  })
  open.push(core)
  // History is off without a window; the clock lets each step count as its own undo step.
  const history = getExtensionDependencyFromEditor(core.editor, HistoryExtension).output
  let clock = 0
  history.now.value = () => clock
  history.disabled.value = false
  // The history takes its base state from the first update it sees, as the first click or key press gives it.
  core.editor.update(() => $getRoot().select(0, 0), { discrete: true })
  return { core, onChange, ops: createCardOps(core.editor, core.gate), tick: () => void (clock += 1000) }
}

const exported = (core: EditorCore): string => core.editor.read(() => $exportMarkdown(TRANSFORMERS, $rootSeams()))

const cardKeys = (core: EditorCore): NodeKey[] =>
  core.editor.read(() => $getRoot().getChildren().filter($isCardNode).map((node) => node.getKey()))

const firstCard = (core: EditorCore): NodeKey => {
  const [key] = cardKeys(core)
  if (key === undefined) throw new Error('no card')
  return key
}

const pressKey = (core: EditorCore, command: typeof KEY_BACKSPACE_COMMAND): void => {
  // No DOM here; the handlers only call `preventDefault` on the event.
  core.editor.dispatchCommand(command, { preventDefault() {}, target: null } as unknown as KeyboardEvent)
}

describe('parseCardUrl', () => {
  it('accepts absolute http(s) URLs only', () => {
    expect(parseCardUrl(' https://a.example/x ')).toBe('https://a.example/x')
    expect(parseCardUrl('http://a.example')).toBe('http://a.example')
    expect(parseCardUrl('ftp://a.example')).toBeNull()
    expect(parseCardUrl('javascript:alert(1)')).toBeNull()
    expect(parseCardUrl('/relative')).toBeNull()
    expect(parseCardUrl('https://a.example/a b')).toBeNull()
  })

  it('encodes unbalanced parentheses as the markup does', () => {
    expect(parseCardUrl('https://a.example/a(b')).toBe('https://a.example/a%28b')
    expect(parseCardUrl('https://a.example/a_(b)')).toBe('https://a.example/a_(b)')
  })
})

describe('setUrl', () => {
  it('points the card at the new URL with one change and one undo step', () => {
    const { core, onChange, ops, tick } = create('before\n@[card](https://a.example)\nafter')
    tick()
    onChange.mockClear()
    expect(ops.setUrl(firstCard(core), ' https://b.example/page ')).toBe(true)
    expect(exported(core)).toBe('before\n@[card](https://b.example/page)\nafter')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('before\n@[card](https://b.example/page)\nafter')
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('before\n@[card](https://a.example)\nafter')
  })

  it('is its own undo step right after other edits', () => {
    const { core, ops } = create('@[card](https://a.example)')
    ops.setUrl(firstCard(core), 'https://b.example')
    ops.setUrl(firstCard(core), 'https://c.example')
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('@[card](https://b.example)')
  })

  it('keeps what a reload would read when the URL has unbalanced parentheses', () => {
    const { core, ops } = create('@[card](https://a.example)')
    expect(ops.setUrl(firstCard(core), 'https://a.example/x(y')).toBe(true)
    expect(exported(core)).toBe('@[card](https://a.example/x%28y)')
    expect(core.editor.read(() => cardKeys(core).map((key) => ($getNodeByKey(key) as CardNode).getURL()))).toEqual(['https://a.example/x%28y'])
  })

  it('removes the card for an empty value', () => {
    const { core, onChange, ops } = create('before\n@[card](https://a.example)\nafter')
    onChange.mockClear()
    expect(ops.setUrl(firstCard(core), '  ')).toBe(true)
    expect(exported(core)).toBe('before\nafter')
    expect(cardKeys(core)).toEqual([])
    expect(onChange).toHaveBeenCalledTimes(1)
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('before\n@[card](https://a.example)\nafter')
  })

  it('leaves a paragraph behind when the only block was the card', () => {
    const { core, onChange, ops } = create('@[card](https://a.example)')
    onChange.mockClear()
    expect(ops.setUrl(firstCard(core), '')).toBe(true)
    expect(exported(core)).toBe('')
    expect(core.editor.read(() => $getRoot().getFirstChild()?.getType())).toBe('paragraph')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it.each(['ftp://x', 'https://a.example/a b', 'not a url', '/relative'])('rejects %j and changes nothing', (url) => {
    const { core, onChange, ops } = create('@[card](https://a.example)')
    onChange.mockClear()
    expect(ops.setUrl(firstCard(core), url)).toBe(false)
    expect(exported(core)).toBe('@[card](https://a.example)')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not emit a change for the same URL', () => {
    const { core, onChange, ops } = create('@[card](https://a.example)')
    onChange.mockClear()
    expect(ops.setUrl(firstCard(core), 'https://a.example')).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('waits for the composition to end', () => {
    vi.useFakeTimers()
    const { core, onChange, ops } = create('@[card](https://a.example)')
    onChange.mockClear()
    core.gate.begin()
    expect(ops.setUrl(firstCard(core), 'https://b.example')).toBe(true)
    expect(exported(core)).toBe('@[card](https://a.example)')
    expect(onChange).not.toHaveBeenCalled()
    core.gate.end()
    vi.runAllTimers()
    expect(exported(core)).toBe('@[card](https://b.example)')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a node that is not a card', () => {
    const { core, onChange } = create('text\n@[card](https://a.example)')
    onChange.mockClear()
    const paragraph = core.editor.read(() => $getRoot().getFirstChildOrThrow().getKey())
    let result: boolean | undefined
    core.editor.update(() => void (result = $setCardUrl(paragraph, 'https://b.example')), { discrete: true })
    expect(result).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('select', () => {
  it('node-selects the card so that Backspace removes it', () => {
    const { core, onChange, ops } = create('before\n@[card](https://a.example)\nafter')
    onChange.mockClear()
    ops.select(firstCard(core))
    expect(core.editor.read(() => $isNodeSelection($getSelection()))).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    pressKey(core, KEY_BACKSPACE_COMMAND)
    expect(exported(core)).toBe('before\nafter')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('removes the selected card on Delete too', () => {
    const { core, ops } = create('@[card](https://a.example)\n@[card](https://b.example)')
    ops.select(firstCard(core))
    pressKey(core, KEY_DELETE_COMMAND)
    expect(exported(core)).toBe('@[card](https://b.example)')
  })
})
