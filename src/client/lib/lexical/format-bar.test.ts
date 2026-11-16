import { getExtensionDependencyFromEditor } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { $getRoot, UNDO_COMMAND } from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorCore, type EditorCore } from './core'
import { applyLink, formatBarState, removeLink, toggleFormat } from './format'
import { $exportMarkdown, $rootSeams, roundTrip, TRANSFORMERS } from './markdown'

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
  history.now.value = () => 0
  history.disabled.value = false
  core.editor.update(() => $getRoot().select(0, 0), { discrete: true })
  return { core, onChange }
}

const exported = (core: EditorCore): string => core.editor.read(() => $exportMarkdown(TRANSFORMERS, $rootSeams()))

/** Selects `from`..`to` of the first text node. */
function select({ editor }: EditorCore, from: number, to: number): void {
  editor.update(() => void $getRoot().getAllTextNodes()[0]!.select(from, to), { discrete: true })
}

describe('toggleFormat', () => {
  it('toggles bold with one change per click', () => {
    const { core, onChange } = create('hello world')
    select(core, 0, 5)
    onChange.mockClear()
    toggleFormat(core.editor, core.gate, 'bold')
    expect(exported(core)).toBe('**hello** world')
    expect(onChange.mock.calls).toEqual([['**hello** world']])
    expect(formatBarState(core.editor).active.has('bold')).toBe(true)
    toggleFormat(core.editor, core.gate, 'bold')
    expect(exported(core)).toBe('hello world')
  })

  it('waits out a composition', () => {
    vi.useFakeTimers()
    const { core } = create('hello')
    select(core, 0, 5)
    core.gate.begin()
    toggleFormat(core.editor, core.gate, 'italic')
    expect(exported(core)).toBe('hello')
    core.gate.end()
    vi.runAllTimers()
    expect(exported(core)).toBe('*hello*')
  })
})

describe('formatBarState', () => {
  it('is hidden while the note is read-only', () => {
    const { core } = create('hello')
    select(core, 0, 5)
    expect(formatBarState(core.editor).visible).toBe(true)
    core.editor.setEditable(false)
    expect(formatBarState(core.editor).visible).toBe(false)
  })
})

describe('applyLink', () => {
  it('links the selection with one change and one undo step', () => {
    const { core, onChange } = create('see docs here')
    select(core, 4, 8)
    onChange.mockClear()
    expect(applyLink(core.editor, core.gate, ' https://a.example/x ')).toBe(true)
    expect(exported(core)).toBe('see [docs](https://a.example/x) here')
    expect(onChange.mock.calls).toEqual([['see [docs](https://a.example/x) here']])
    expect(formatBarState(core.editor).active.has('link')).toBe(true)
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('see docs here')
  })

  it('keeps the text formats inside the link', () => {
    const { core } = create('**docs**')
    select(core, 0, 4)
    expect(applyLink(core.editor, core.gate, 'https://a.example')).toBe(true)
    expect(exported(core)).toBe('[**docs**](https://a.example)')
  })

  it('writes the href the app opens for www. and e-mail targets', () => {
    const www = create('docs')
    select(www.core, 0, 4)
    expect(applyLink(www.core.editor, www.core.gate, 'www.a.example')).toBe(true)
    expect(exported(www.core)).toBe('[docs](http://www.a.example)')
    const mail = create('me')
    select(mail.core, 0, 2)
    expect(applyLink(mail.core.editor, mail.core.gate, 'me@a.example')).toBe(true)
    expect(exported(mail.core)).toBe('[me](mailto:me@a.example)')
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://a.example/x', '/relative', 'plain', '', '   '])('refuses %j', (url) => {
    const { core, onChange } = create('docs')
    select(core, 0, 4)
    onChange.mockClear()
    expect(applyLink(core.editor, core.gate, url)).toBe(false)
    expect(exported(core)).toBe('docs')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('refuses a caret and a selection in code', () => {
    const caret = create('docs')
    select(caret.core, 2, 2)
    expect(applyLink(caret.core.editor, caret.core.gate, 'https://a.example')).toBe(false)
    const code = create('```\ndocs\n```')
    select(code.core, 0, 4)
    expect(applyLink(code.core.editor, code.core.gate, 'https://a.example')).toBe(false)
    expect(exported(code.core)).toBe('```\ndocs\n```')
  })

  it('writes a destination that a reload reads back as the same link', () => {
    for (const url of ['https://a.example/a b', 'https://a.example/x(y', 'https://a.example/x_(y)']) {
      const { core } = create('docs')
      select(core, 0, 4)
      expect(applyLink(core.editor, core.gate, url)).toBe(true)
      const markdown = exported(core)
      expect(roundTrip(markdown)).toBe(markdown)
    }
  })
})

describe('removeLink', () => {
  it('keeps the text and is one undo step', () => {
    const { core, onChange } = create('see [docs](https://a.example) here')
    core.editor.update(() => void $getRoot().getAllTextNodes()[1]!.select(0, 4), { discrete: true })
    expect(formatBarState(core.editor).active.has('link')).toBe(true)
    onChange.mockClear()
    removeLink(core.editor, core.gate)
    expect(exported(core)).toBe('see docs here')
    expect(onChange).toHaveBeenCalledTimes(1)
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    expect(exported(core)).toBe('see [docs](https://a.example) here')
  })
})
