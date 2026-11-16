import { getExtensionDependencyFromEditor } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { $isListNode } from '@lexical/list'
import { $isTableCellNode, $isTableNode } from '@lexical/table'
import {
  $createNodeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  IS_APPLE,
  KEY_DOWN_COMMAND,
  UNDO_COMMAND,
  type LexicalNode,
  type NodeKey,
  type TextNode,
} from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type BlockBox, blockIndexAt, canMoveBlock, dropPointAt, moveBlock, moveCaretBlock } from './blocks'
import { createEditorCore, type EditorCore } from './core'
import { $exportMarkdown, $rootSeams, TRANSFORMERS } from './markdown'
import { $isCardNode } from './nodes/card-node'

const open: EditorCore[] = []
afterEach(() => {
  for (const core of open.splice(0)) core.destroy()
  vi.useRealTimers()
})

function create(value: string, readOnly = false) {
  const onChange = vi.fn<(markdown: string) => void>()
  const core = createEditorCore({
    value,
    readOnly,
    tasksToggleable: false,
    onChange,
    onPaste: () => {},
    onUnsupported: () => {},
    onEmptyChange: () => {},
  })
  open.push(core)
  // History is off without a window; the clock lets each step count as its own undo step.
  const history = getExtensionDependencyFromEditor(core.editor, HistoryExtension).output
  history.now.value = () => 0
  history.disabled.value = false
  // The history takes its base state from the first update it sees, as the first click or key press gives it.
  core.editor.update(() => $getRoot().select(0, 0), { discrete: true })
  // Seams as the editor records them at load: only these pairs skip the blank-line rule.
  const seams = core.editor.read($rootSeams)
  return { core, onChange, exported: () => core.editor.read(() => $exportMarkdown(TRANSFORMERS, seams)) }
}

const keyWhere = (core: EditorCore, test: (node: LexicalNode) => boolean): NodeKey =>
  core.editor.read(() => $getRoot().getChildren().find(test)!.getKey())
const keyOfText = (core: EditorCore, text: string): NodeKey =>
  keyWhere(core, (node) => $isParagraphNode(node) && node.getTextContent() === text)

const $getTextByKey = (key: NodeKey): TextNode => $getNodeByKey(key) as TextNode

const undo = (core: EditorCore): void => void core.editor.dispatchCommand(UNDO_COMMAND, undefined)

describe('moveBlock', () => {
  it('moves a paragraph above and below another and leaves the blank lines where they were', () => {
    const above = create('a\n\nb\n\nc')
    expect(above.core.editor.read(() => $getRoot().getChildrenSize())).toBe(5)
    expect(moveBlock(above.core.editor, above.core.gate, keyOfText(above.core, 'c'), keyOfText(above.core, 'a'), 'before')).toBe(true)
    expect(above.exported()).toBe('c\na\n\nb\n')

    const below = create('a\n\nb\n\nc')
    expect(moveBlock(below.core.editor, below.core.gate, keyOfText(below.core, 'a'), keyOfText(below.core, 'c'), 'after')).toBe(true)
    expect(below.exported()).toBe('\nb\n\nc\na')

    const top = create('a\n\nb\n\nc')
    expect(moveBlock(top.core.editor, top.core.gate, keyOfText(top.core, 'b'), keyOfText(top.core, 'a'), 'before')).toBe(true)
    expect(top.exported()).toBe('b\na\n\n\nc')
  })

  it('moves a whole list and puts a blank line where the next block would read as part of it', () => {
    const { core, exported } = create('p\n- x\n- y')
    expect(exported()).toBe('p\n- x\n- y')
    moveBlock(core.editor, core.gate, keyOfText(core, 'p'), keyWhere(core, $isListNode), 'after')
    expect(exported()).toBe('- x\n- y\n\np')

    undo(core)
    expect(exported()).toBe('p\n- x\n- y')
    moveBlock(core.editor, core.gate, keyWhere(core, $isListNode), keyOfText(core, 'p'), 'before')
    expect(exported()).toBe('- x\n- y\n\np')
  })

  it('moves a table next to a paragraph', () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    const { core, onChange, exported } = create(`p\n\n${table}`)
    moveBlock(core.editor, core.gate, keyWhere(core, $isTableNode), keyOfText(core, 'p'), 'before')
    expect(exported()).toBe(`${table}\n\np\n`)
    expect(onChange).toHaveBeenLastCalledWith(`${table}\n\np\n`)

    moveBlock(core.editor, core.gate, keyOfText(core, 'p'), keyWhere(core, $isTableNode), 'before')
    expect(exported()).toBe(`p\n${table}\n`)
  })

  it('moves a card and an image paragraph', () => {
    const image = '![alt](https://example.com/a.png)'
    const card = '@[card](https://example.com/x)'
    const { core, exported } = create(`a\n${card}\n${image}\nb`)
    expect(exported()).toBe(`a\n${card}\n${image}\nb`)

    moveBlock(core.editor, core.gate, keyWhere(core, $isCardNode), keyOfText(core, 'b'), 'after')
    expect(exported()).toBe(`a\n${image}\nb\n${card}`)

    const imageKey = keyWhere(core, (node) => $isParagraphNode(node) && node.getTextContentSize() > 0 && !node.getTextContent().startsWith('a') && node.getTextContent() !== 'b')
    moveBlock(core.editor, core.gate, imageKey, keyOfText(core, 'a'), 'before')
    expect(exported()).toBe(`${image}\na\nb\n${card}`)
  })

  it('keeps the selection: a caret in text, a node selection on a card, a caret in a table cell', () => {
    const card = create('a\n@[card](https://example.com/x)\nb')
    const cardKey = keyWhere(card.core, $isCardNode)
    card.core.editor.update(
      () => {
        const selection = $createNodeSelection()
        selection.add(cardKey)
        $setSelection(selection)
      },
      { discrete: true },
    )
    moveBlock(card.core.editor, card.core.gate, cardKey, keyOfText(card.core, 'a'), 'before')
    expect(card.exported()).toBe('@[card](https://example.com/x)\na\nb')
    card.core.editor.read(() => {
      const selection = $getSelection()
      expect($isNodeSelection(selection) && [...selection.getNodes()].map((node) => node.getKey())).toEqual([cardKey])
    })

    const text = create('abc\ndef')
    const textKey = text.core.editor.read(() => $getRoot().getAllTextNodes()[1]!.getKey())
    text.core.editor.update(() => void $getTextByKey(textKey).select(2, 2), { discrete: true })
    moveBlock(text.core.editor, text.core.gate, keyOfText(text.core, 'def'), keyOfText(text.core, 'abc'), 'before')
    expect(text.exported()).toBe('def\nabc')
    text.core.editor.read(() => {
      const selection = $getSelection()
      expect($isRangeSelection(selection) && selection.anchor.key === textKey && selection.anchor.offset === 2 && selection.isCollapsed()).toBe(true)
    })

    const cell = create('| a | b |\n| --- | --- |\n| 1 | 2 |\n\np')
    const cellKey = cell.core.editor.read(() => $getRoot().getAllTextNodes().find((node) => node.getTextContent() === '2')!.getKey())
    cell.core.editor.update(() => void $getTextByKey(cellKey).select(1, 1), { discrete: true })
    moveBlock(cell.core.editor, cell.core.gate, keyWhere(cell.core, $isTableNode), keyOfText(cell.core, 'p'), 'after')
    cell.core.editor.read(() => {
      const selection = $getSelection()
      expect($isRangeSelection(selection) && selection.anchor.key === cellKey && selection.anchor.offset === 1).toBe(true)
      expect($getNodeByKey(cellKey)!.getParents().some($isTableCellNode)).toBe(true)
    })
  })

  it('refuses a move onto itself and a move that leaves the block where it is', () => {
    const { core, onChange, exported } = create('a\nb\nc')
    const [a, b, c] = ['a', 'b', 'c'].map((text) => keyOfText(core, text)) as [NodeKey, NodeKey, NodeKey]
    expect(moveBlock(core.editor, core.gate, b, b, 'before')).toBe(false)
    expect(moveBlock(core.editor, core.gate, b, b, 'after')).toBe(false)
    expect(moveBlock(core.editor, core.gate, b, c, 'before')).toBe(false)
    expect(moveBlock(core.editor, core.gate, b, a, 'after')).toBe(false)
    expect(canMoveBlock(core.editor, b, c, 'after')).toBe(true)
    expect(exported()).toBe('a\nb\nc')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('refuses nodes that are not root children', () => {
    const { core, onChange } = create('- x\n- y\n\nb')
    const item = core.editor.read(() => $getRoot().getAllTextNodes()[0]!.getParentOrThrow().getKey())
    expect(moveBlock(core.editor, core.gate, item, keyOfText(core, 'b'), 'after')).toBe(false)
    expect(moveBlock(core.editor, core.gate, keyOfText(core, 'b'), item, 'before')).toBe(false)
    expect(moveBlock(core.editor, core.gate, keyOfText(core, 'b'), 'nope', 'before')).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is one undo step and one onChange', () => {
    const { core, onChange, exported } = create('a\nb\nc\nd')
    moveBlock(core.editor, core.gate, keyOfText(core, 'a'), keyOfText(core, 'c'), 'after')
    expect(exported()).toBe('b\nc\na\nd')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('b\nc\na\nd')

    undo(core)
    expect(exported()).toBe('a\nb\nc\nd')
    expect(onChange).toHaveBeenLastCalledWith('a\nb\nc\nd')
  })

  it('merges the two lists a paragraph leaves behind, and one undo restores them', () => {
    const { core, onChange, exported } = create('- a\np\n- b')
    expect(core.editor.read(() => $getRoot().getChildren().filter($isListNode).length)).toBe(2)
    moveBlock(core.editor, core.gate, keyOfText(core, 'p'), keyWhere(core, $isListNode), 'before')
    expect(exported()).toBe('p\n- a\n- b')
    expect(core.editor.read(() => $getRoot().getChildren().filter($isListNode).length)).toBe(1)
    expect(onChange).toHaveBeenCalledTimes(1)

    undo(core)
    expect(exported()).toBe('- a\np\n- b')
    expect(core.editor.read(() => $getRoot().getChildren().filter($isListNode).length)).toBe(2)
  })

  it('refuses while the editor is read-only', () => {
    const { core, onChange, exported } = create('a\nb', true)
    expect(moveBlock(core.editor, core.gate, keyOfText(core, 'a'), keyOfText(core, 'b'), 'after')).toBe(false)
    expect(moveCaretBlock(core.editor, core.gate, 'down')).toBe(false)
    expect(exported()).toBe('a\nb')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('waits out a composition', () => {
    vi.useFakeTimers()
    const { core, exported } = create('a\nb')
    core.gate.begin()
    expect(moveBlock(core.editor, core.gate, keyOfText(core, 'a'), keyOfText(core, 'b'), 'after')).toBe(true)
    expect(exported()).toBe('a\nb')
    core.gate.end()
    vi.runAllTimers()
    expect(exported()).toBe('b\na')
  })
})

describe('moveCaretBlock', () => {
  /** Puts the caret in the text node holding `text`. */
  function caretIn(core: EditorCore, text: string): void {
    core.editor.update(() => void $getRoot().getAllTextNodes().find((node) => node.getTextContent() === text)!.select(1, 1), { discrete: true })
  }

  it('moves the block by one non-empty block and skips blank lines', () => {
    const { core, exported } = create('a\n\nb\n\n\nc')
    caretIn(core, 'c')
    expect(moveCaretBlock(core.editor, core.gate, 'up')).toBe(true)
    expect(exported()).toBe('a\n\nc\nb\n\n')
    expect(moveCaretBlock(core.editor, core.gate, 'up')).toBe(true)
    expect(exported()).toBe('c\na\n\nb\n\n')
    expect(moveCaretBlock(core.editor, core.gate, 'up')).toBe(false)
    expect(moveCaretBlock(core.editor, core.gate, 'down')).toBe(true)
    expect(exported()).toBe('a\nc\n\nb\n\n')
  })

  it('moves a block holding a table cell caret and a selected card', () => {
    const { core, exported } = create('| a | b |\n| --- | --- |\n| 1 | 2 |\n\np\n@[card](https://example.com/x)')
    core.editor.update(() => void $getRoot().getAllTextNodes().find((node) => node.getTextContent() === '2')!.select(0, 0), { discrete: true })
    expect(moveCaretBlock(core.editor, core.gate, 'down')).toBe(true)
    expect(exported()).toBe('\np\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n@[card](https://example.com/x)')

    const cardKey = keyWhere(core, $isCardNode)
    core.editor.update(
      () => {
        const selection = $createNodeSelection()
        selection.add(cardKey)
        $setSelection(selection)
      },
      { discrete: true },
    )
    expect(moveCaretBlock(core.editor, core.gate, 'up')).toBe(true)
    expect(exported()).toBe('\np\n@[card](https://example.com/x)\n| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it('does nothing on a blank line or without a caret in a block', () => {
    const { core, onChange } = create('a\n\nb')
    core.editor.update(() => void $getRoot().getChildren()[1]!.selectStart(), { discrete: true })
    expect(moveCaretBlock(core.editor, core.gate, 'down')).toBe(false)
    core.editor.update(() => void $getRoot().select(0, 0), { discrete: true })
    expect(moveCaretBlock(core.editor, core.gate, 'down')).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('block keys', () => {
  // Headless runs as a non-Apple platform, where Mod is Ctrl.
  function press(core: EditorCore, key: string, modifiers: { shift?: boolean; alt?: boolean; mod?: boolean } = {}) {
    const preventDefault = vi.fn()
    const event = {
      key,
      shiftKey: modifiers.shift ?? true,
      altKey: modifiers.alt ?? false,
      metaKey: (modifiers.mod ?? true) && IS_APPLE,
      ctrlKey: (modifiers.mod ?? true) && !IS_APPLE,
      preventDefault,
    } as unknown as KeyboardEvent
    core.editor.dispatchCommand(KEY_DOWN_COMMAND, event)
    return preventDefault
  }
  const caretIn = (core: EditorCore, text: string): void =>
    core.editor.update(() => void $getRoot().getAllTextNodes().find((node) => node.getTextContent() === text)!.select(0, 0), { discrete: true })

  it('moves the caret block with Mod-Shift-ArrowDown and ArrowUp, once each', () => {
    const { core, onChange, exported } = create('a\n\nb')
    caretIn(core, 'a')
    expect(press(core, 'ArrowDown')).toHaveBeenCalledTimes(1)
    expect(exported()).toBe('\nb\na')
    expect(onChange).toHaveBeenCalledTimes(1)
    press(core, 'ArrowUp')
    expect(exported()).toBe('\na\nb')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('claims the key at the edge without changing anything', () => {
    const { core, onChange } = create('a\nb')
    caretIn(core, 'a')
    expect(press(core, 'ArrowUp')).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores other modifiers, a read-only editor, and does nothing while composing', () => {
    const { core, exported } = create('a\nb')
    caretIn(core, 'a')
    expect(press(core, 'ArrowDown', { shift: false })).not.toHaveBeenCalled()
    expect(press(core, 'ArrowDown', { alt: true })).not.toHaveBeenCalled()
    expect(press(core, 'ArrowDown', { mod: false })).not.toHaveBeenCalled()
    core.gate.begin()
    press(core, 'ArrowDown')
    core.gate.end()
    expect(exported()).toBe('a\nb')
    core.setReadOnly(true, false)
    expect(press(core, 'ArrowDown')).not.toHaveBeenCalled()
    expect(exported()).toBe('a\nb')
  })
})

describe('drop points', () => {
  const box = (key: string, top: number, bottom: number, blank = false): BlockBox => ({ key, top, bottom, blank })
  const boxes = [box('a', 0, 20), box('x', 20, 40, true), box('b', 40, 60), box('c', 60, 100)]

  it('finds the block that starts at or above the pointer', () => {
    expect(blockIndexAt(boxes, -5)).toBe(-1)
    expect(blockIndexAt(boxes, 0)).toBe(0)
    expect(blockIndexAt(boxes, 30)).toBe(1)
    expect(blockIndexAt(boxes, 59)).toBe(2)
    expect(blockIndexAt(boxes, 500)).toBe(3)
    expect(blockIndexAt([], 5)).toBe(-1)
  })

  it('picks the nearest edge of a non-empty block, and the side across blank lines the line shows', () => {
    expect(dropPointAt(boxes, -10)).toEqual({ key: 'a', side: 'before', line: 0 })
    expect(dropPointAt(boxes, 500)).toEqual({ key: 'c', side: 'after', line: 100 })
    expect(dropPointAt(boxes, 25)).toEqual({ key: 'a', side: 'after', line: 20 })
    expect(dropPointAt(boxes, 35)).toEqual({ key: 'b', side: 'before', line: 40 })
    expect(dropPointAt(boxes, 70)).toEqual({ key: 'c', side: 'before', line: 60 })
    expect(dropPointAt(boxes, 95)).toEqual({ key: 'c', side: 'after', line: 100 })
  })

  it('has no drop point without a non-empty block', () => {
    expect(dropPointAt([], 5)).toBeNull()
    expect(dropPointAt([box('x', 0, 20, true)], 5)).toBeNull()
  })
})
