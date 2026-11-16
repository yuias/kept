import { getExtensionDependencyFromEditor } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import { AutoLinkNode } from '@lexical/link'
import {
  $getRoot,
  $isRangeSelection,
  $nodesOfType,
  UNDO_COMMAND,
  type TextNode,
} from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorCore, EXTERNAL_TAG, type EditorCore, type EditorCoreOptions } from './core'
import { $exportMarkdown, $rootSeams, roundTrip, TRANSFORMERS } from './markdown'

const fixtures = (files: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(files).map(([path, text]) => [path.slice(path.lastIndexOf('/') + 1), text]))
const identical = fixtures(import.meta.glob('./fixtures/identical/*.md', { query: '?raw', import: 'default', eager: true }))
const normalizeIn = fixtures(import.meta.glob('./fixtures/normalize/*.in.md', { query: '?raw', import: 'default', eager: true }))

const open: EditorCore[] = []
afterEach(() => {
  for (const core of open.splice(0)) core.destroy()
})

function create(value: string, overrides: Partial<EditorCoreOptions> = {}) {
  const onChange = vi.fn<(markdown: string) => void>()
  const onEmptyChange = vi.fn<(empty: boolean) => void>()
  const core = createEditorCore({
    value,
    readOnly: false,
    tasksToggleable: false,
    onChange,
    onPaste: () => {},
    onUnsupported: () => {},
    onEmptyChange,
    ...overrides,
  })
  open.push(core)
  return { core, onChange, onEmptyChange }
}

/** The export the core would compare against, read without going through its listeners. */
const exported = (core: EditorCore): string =>
  core.editor.read(() => $exportMarkdown(TRANSFORMERS, core.editor.read($rootSeams)))

/** Lets any deferred commit or listener run before asserting that nothing happened. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Types `text` at the end of the document, as a user would. */
function type(core: EditorCore, text: string): void {
  core.editor.update(
    () => {
      const selection = $getRoot().selectEnd()
      if ($isRangeSelection(selection)) selection.insertText(text)
    },
    { discrete: true },
  )
}

describe('change detection', () => {
  it('does not emit for the initial state', async () => {
    const { onChange } = create('# title\n\nbody')
    await settle()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not emit for a selection-only update', async () => {
    const { core, onChange } = create('one\ntwo')
    core.editor.update(() => void $getRoot().selectEnd(), { discrete: true })
    core.editor.update(() => void $getRoot().selectStart(), { discrete: true })
    await settle()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not emit for an update tagged as external', async () => {
    const { core, onChange } = create('one')
    core.editor.update(() => void $getRoot().getLastChild()!.remove(), { discrete: true, tag: EXTERNAL_TAG })
    await settle()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not emit for setValue', async () => {
    const { core, onChange } = create('one')
    core.setValue('two\nthree')
    await settle()
    expect(onChange).not.toHaveBeenCalled()
    expect(exported(core)).toBe('two\nthree')
  })

  it('emits once with the new markdown after typing', async () => {
    const { core, onChange } = create('one')
    type(core, '!')
    await settle()
    expect(onChange.mock.calls).toEqual([['one!']])
  })

  it('does not emit again when an update exports the same markdown', async () => {
    const { core, onChange } = create('one')
    type(core, '!')
    core.editor.update(() => $getRoot().getLastChild()!.markDirty(), { discrete: true })
    await settle()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('compares with the export of the loaded state, not with the source', async () => {
    const { core, onChange } = create(normalizeIn.get('emphasis-underscore.in.md')!)
    core.editor.update(
      () => {
        const text = $getRoot().getAllTextNodes()[0]!
        text.markDirty()
        text.getParentOrThrow().markDirty()
      },
      { discrete: true },
    )
    await settle()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('joins a loaded seam with a single newline', async () => {
    const { core, onChange } = create('- a\nb')
    type(core, 'X')
    await settle()
    expect(onChange.mock.calls).toEqual([['- a\nbX']])
    expect(exported(core)).toBe('- a\nbX')
  })

  it('uses the seams of the latest setValue', async () => {
    const { core, onChange } = create('x')
    core.setValue('- a\nb')
    type(core, 'X')
    await settle()
    expect(onChange.mock.calls).toEqual([['- a\nbX']])
  })

  it('emits for an undo', async () => {
    const { core, onChange } = create('one')
    let clock = 0
    const history = getExtensionDependencyFromEditor(core.editor, HistoryExtension).output
    history.now.value = () => clock
    history.disabled.value = false
    type(core, 'a')
    clock += 1000
    type(core, 'b')
    await settle()
    core.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await settle()
    expect(onChange.mock.calls).toEqual([['onea'], ['oneab'], ['onea']])
  })
})

describe('empty state', () => {
  it('reports the initial state and then only changes', async () => {
    const { core, onEmptyChange } = create('')
    expect(onEmptyChange.mock.calls).toEqual([[true]])
    type(core, 'a')
    type(core, 'b')
    expect(onEmptyChange.mock.calls).toEqual([[true], [false]])
    core.setValue('')
    expect(onEmptyChange.mock.calls).toEqual([[true], [false], [true]])
  })

  it('is not empty for a loaded note', () => {
    const { onEmptyChange } = create('text')
    expect(onEmptyChange.mock.calls).toEqual([[false]])
  })
})

describe('read-only', () => {
  it('follows the option and setReadOnly', () => {
    const { core } = create('x', { readOnly: true })
    expect(core.editor.isEditable()).toBe(false)
    core.setReadOnly(false, true)
    expect(core.editor.isEditable()).toBe(true)
  })
})

describe('auto links', () => {
  const source = 'see https://e.example and `https://c.example`'
  const links = (core: EditorCore) => core.editor.read(() => $nodesOfType(AutoLinkNode).map((node) => node.getIsUnlinked()))

  it('links a bare URL and unlinks one inside inline code', () => {
    const { core } = create(source)
    expect(links(core)).toEqual([false, true])
  })

  it('unlinks an auto link that gets the code format', () => {
    const { core } = create('see https://e.example')
    core.editor.update(
      () => {
        const link = $nodesOfType(AutoLinkNode)[0]!
        ;(link.getFirstChild() as TextNode).toggleFormat('code')
      },
      { discrete: true },
    )
    expect(links(core)).toEqual([true])
  })

  it('creates none in a fenced code block', () => {
    const { core } = create('```\nhttps://e.example\n```')
    expect(links(core)).toEqual([])
  })

  it('exports bare URLs unchanged', async () => {
    const { core, onChange } = create(source)
    type(core, '!')
    await settle()
    expect(onChange.mock.calls).toEqual([[`${source}!`]])
  })
})

describe('first export', () => {
  const sources = [...identical, ...normalizeIn]

  it.each(sources)('equals the headless round trip of %s', (_name, source) => {
    const { core } = create(source)
    expect(exported(core)).toBe(roundTrip(source))
  })
})
