import { $createCodeNode } from '@lexical/code-core'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setCompositionKey,
  HISTORIC_TAG,
  type LexicalEditorWithDispose,
  PASTE_TAG,
  UNDO_COMMAND,
} from 'lexical'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CompositionGate } from './composition'
import { createEditorCore, EXTERNAL_TAG, type EditorCore } from './core'
import { buildEmojiIndex, type EmojiIndex, loadEmojiIndex, matchEmoji, pickEmoji, shortcodeQuery } from './emoji'
import { createTestEditor, settle, type TestEditor, typeText } from './test-editor'

let index: EmojiIndex
beforeAll(async () => {
  index = (await loadEmojiIndex())!
})

const created: Array<() => void> = []
afterEach(() => {
  for (const dispose of created.splice(0)) dispose()
})

function create(markdown = ''): TestEditor {
  const t = createTestEditor(markdown)
  created.push(() => t.editor.dispose())
  return t
}

/** Types `text` at the end of an editor that holds `markdown`, then reports the query. */
async function queryAfter(markdown: string, text: string): Promise<string | null> {
  const t = create(markdown)
  await typeText(t.editor, text)
  return shortcodeQuery(t.editor)?.query ?? null
}

describe('shortcode query', () => {
  it('reads the name after the colon', async () => {
    expect(await queryAfter('', ':sm')).toBe('sm')
    expect(await queryAfter('', ':smile')).toBe('smile')
    expect(await queryAfter('', ':+1')).toBe('+1')
  })

  it('needs two characters', async () => {
    expect(await queryAfter('', ':')).toBeNull()
    expect(await queryAfter('', ':s')).toBeNull()
  })

  it('opens inside Japanese text and after punctuation or a space', async () => {
    expect(await queryAfter('', '今日は:smi')).toBe('smi')
    expect(await queryAfter('', 'look, (:smi')).toBe('smi')
    expect(await queryAfter('', 'a :smi')).toBe('smi')
  })

  it('stays closed after a letter, a digit, a colon or a slash', async () => {
    expect(await queryAfter('', '12:30')).toBeNull()
    expect(await queryAfter('', 'a:bc')).toBeNull()
    expect(await queryAfter('', 'a::bc')).toBeNull()
    expect(await queryAfter('', 'http://')).toBeNull()
    expect(await queryAfter('', 'http://example')).toBeNull()
    expect(await queryAfter('', 'a/:bc')).toBeNull()
  })

  it('ignores the full-width colon and characters outside the name set', async () => {
    expect(await queryAfter('', '：smi')).toBeNull()
    expect(await queryAfter('', ':SMI')).toBeNull()
    expect(await queryAfter('', ':smi ')).toBeNull()
  })

  it('stays closed in inline code and in a code block', async () => {
    const t = create()
    t.editor.update(
      () => {
        const code = $createCodeNode()
        code.append($createTextNode(':smi'))
        $getRoot().clear().append(code)
        code.selectEnd()
      },
      { discrete: true },
    )
    expect(shortcodeQuery(t.editor)).toBeNull()

    const inline = create()
    inline.editor.update(
      () => {
        const paragraph = $createParagraphNode().append($createTextNode(':smi').toggleFormat('code'))
        $getRoot().clear().append(paragraph)
        paragraph.selectEnd()
      },
      { discrete: true },
    )
    expect(shortcodeQuery(inline.editor)).toBeNull()
  })

  it('stays closed for a range, while composing and while read-only', async () => {
    const t = create()
    await typeText(t.editor, ':smi')
    t.editor.update(() => $getSelection() && $getRoot().select(0, 1), { discrete: true })
    expect(shortcodeQuery(t.editor)).toBeNull()

    const composing = create()
    await typeText(composing.editor, ':smi')
    composing.editor.update(() => $setCompositionKey($getRoot().getAllTextNodes()[0]!.getKey()), { discrete: true })
    expect(shortcodeQuery(composing.editor)).toBeNull()

    const readOnly = create()
    await typeText(readOnly.editor, ':smi')
    readOnly.editor.setEditable(false)
    expect(shortcodeQuery(readOnly.editor)).toBeNull()
  })
})

describe('matchEmoji', () => {
  it('lists names that start with the query before names that contain it', () => {
    const names = matchEmoji(index, 'sm', 8).map((entry) => entry.name)
    expect(names).toContain('smile')
    const firstInner = names.findIndex((name) => !name.startsWith('sm'))
    if (firstInner >= 0) expect(names.slice(firstInner).every((name) => !name.startsWith('sm'))).toBe(true)
    expect(names.length).toBeLessThanOrEqual(8)
  })

  it('keeps the list order inside each group', () => {
    const small = buildEmojiIndex([
      { emoji: '1', names: ['xa_smile'] },
      { emoji: '2', names: ['smile_b'] },
      { emoji: '3', names: ['x_smile'] },
      { emoji: '4', names: ['smile'] },
    ])
    expect(matchEmoji(small, 'smile', 8).map((entry) => entry.emoji)).toEqual(['2', '4', '1', '3'])
    expect(matchEmoji(small, 'smile', 3).map((entry) => entry.emoji)).toEqual(['2', '4', '1'])
  })

  it('indexes every name of an emoji, lower case', () => {
    expect(index.byName.get('thumbsup')).toBe(index.byName.get('+1'))
    expect(matchEmoji(buildEmojiIndex([{ emoji: 'e', names: ['MiXed'] }]), 'mix', 8)).toEqual([{ name: 'mixed', emoji: 'e' }])
  })
})

describe('closing colon', () => {
  it('turns a typed :smile: into the emoji', async () => {
    const t = create()
    await typeText(t.editor, ':smile:')
    expect(t.markdown()).toBe('😄')
  })

  it('keeps typing after the emoji', async () => {
    const t = create()
    await typeText(t.editor, 'a :smile: b')
    expect(t.markdown()).toBe('a 😄 b')
  })

  it('converts names that hold underscores, plus signs and digits', async () => {
    const names: Array<[string, string]> = [
      [':smiling_face_with_three_hearts:', '🥰'],
      [':+1:', '👍'],
      [':-1:', '👎'],
      [':100:', '💯'],
      [':e-mail:', '📧'],
    ]
    for (const [text, emoji] of names) {
      const t = create()
      await typeText(t.editor, text)
      expect(t.markdown(), text).toBe(emoji)
    }
  })

  it('converts after Japanese text and one-letter names', async () => {
    const t = create()
    await typeText(t.editor, '今日は:smile:')
    expect(t.markdown()).toBe('今日は😄')
    const x = create()
    await typeText(x.editor, ':x:')
    expect(x.markdown()).toBe('❌')
  })

  it('leaves an unknown name, a time and a url as typed', async () => {
    for (const text of [':nosuch:', '12:30:', 'a:smile:', 'http://smile:', '：smile：']) {
      const t = create()
      await typeText(t.editor, text)
      expect(t.markdown(), text).toBe(text)
    }
  })

  it('does not convert in code', async () => {
    const inline = create()
    inline.editor.update(
      () => {
        const text = $createTextNode(':smilea').toggleFormat('code')
        $getRoot().clear().append($createParagraphNode().append(text))
        const selection = text.select(6, 6)
        // Typing continues in the format of the text, as the DOM selection reports it.
        selection.format = text.getFormat()
      },
      { discrete: true },
    )
    await typeText(inline.editor, ':')
    expect(inline.markdown()).toBe('`:smile:a`')

    const block = create()
    block.editor.update(
      () => {
        const code = $createCodeNode()
        code.append($createTextNode(':smile'))
        $getRoot().clear().append(code)
        code.selectEnd()
      },
      { discrete: true },
    )
    await typeText(block.editor, ':')
    expect(block.markdown()).toBe('```\n:smile:\n```')
  })

  it('does not convert a caret that only moved over the colon', async () => {
    const t = create()
    await typeText(t.editor, ':nosuch:')
    t.editor.update(() => $getRoot().getAllTextNodes()[0]!.select(7, 7), { discrete: true })
    t.editor.update(() => $getRoot().getAllTextNodes()[0]!.select(8, 8), { discrete: true })
    await settle()
    expect(t.markdown()).toBe(':nosuch:')
  })

  it('keeps a pasted, synced or undone :smile:', async () => {
    for (const tag of [PASTE_TAG, EXTERNAL_TAG, HISTORIC_TAG]) {
      const t = create()
      await typeText(t.editor, ':smile')
      t.editor.update(
        () => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) selection.insertText(':')
        },
        { discrete: true, tag },
      )
      await settle()
      expect(t.markdown(), tag).toBe(':smile:')
    }
    const pasted = create()
    pasted.editor.update(
      () => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertText(':smile:')
      },
      { discrete: true, tag: PASTE_TAG },
    )
    await settle()
    expect(pasted.markdown()).toBe(':smile:')
  })

  it('does not convert while an IME composition is active', async () => {
    const t = create()
    await typeText(t.editor, ':smile')
    t.editor.update(() => $setCompositionKey($getRoot().getAllTextNodes()[0]!.getKey()), { discrete: true })
    await typeText(t.editor, ':')
    expect(t.markdown()).toBe(':smile:')
  })

  it('is its own undo step', async () => {
    const t = create()
    await typeText(t.editor, ':smile:')
    t.tick()
    expect(t.markdown()).toBe('😄')
    t.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await settle()
    expect(t.markdown()).toBe(':smile:')
    t.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await settle()
    expect(t.markdown()).toBe('')
  })

  it('emits one change for the replacement', async () => {
    const onChange = vi.fn<(markdown: string) => void>()
    const core: EditorCore = createEditorCore({
      value: '',
      readOnly: false,
      tasksToggleable: false,
      onChange,
      onPaste: () => {},
      onUnsupported: () => {},
      onEmptyChange: () => {},
    })
    created.push(() => core.destroy())
    // The core builds a disposable editor; its type only says LexicalEditor.
    const editor = core.editor as LexicalEditorWithDispose
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    await typeText(editor, ':smile')
    onChange.mockClear()
    await typeText(editor, ':')
    expect(onChange.mock.calls).toEqual([[':smile:'], ['😄']])
  })
})

describe('picking from the menu', () => {
  const pick = (t: TestEditor, emoji: string): void => {
    pickEmoji(t.editor, new CompositionGate(t.editor), emoji)
  }

  it('replaces :query with the emoji and puts the caret after it', async () => {
    const t = create()
    await typeText(t.editor, 'hi :smi')
    pick(t, '😄')
    await typeText(t.editor, '!')
    expect(t.markdown()).toBe('hi 😄!')
  })

  it('takes a closing colon that is right after the caret', async () => {
    const t = create()
    await typeText(t.editor, ':smi:')
    t.editor.update(() => $getRoot().getAllTextNodes()[0]!.select(4, 4), { discrete: true })
    pick(t, '😄')
    expect(t.markdown()).toBe('😄')
  })

  it('does nothing without a shortcode', async () => {
    const t = create()
    await typeText(t.editor, 'plain')
    pick(t, '😄')
    expect(t.markdown()).toBe('plain')
  })

  it('is one undo step', async () => {
    const t = create()
    await typeText(t.editor, ':smi')
    t.tick()
    pick(t, '😄')
    t.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await settle()
    expect(t.markdown()).toBe(':smi')
  })
})

describe('loading', () => {
  it('shares one list between callers', async () => {
    expect(await loadEmojiIndex()).toBe(index)
  })

  it('has the entries the menu relies on', () => {
    expect(index.byName.get('smile')).toBe('😄')
    expect(index.byName.get('a')).toBeDefined()
  })
})
