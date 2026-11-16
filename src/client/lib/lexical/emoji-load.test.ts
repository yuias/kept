import { $getRoot } from 'lexical'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { createTestEditor as CreateTestEditor, settle as Settle, typeText as TypeText } from './test-editor'

// The list's chunk is held back until `release`, as on the first use after a page load.
const chunk = { requested: 0, release: () => {}, ready: Promise.resolve() }

let createTestEditor: typeof CreateTestEditor
let settle: typeof Settle
let typeText: typeof TypeText
const created: Array<() => void> = []

beforeEach(async () => {
  chunk.requested = 0
  chunk.ready = new Promise<void>((resolve) => (chunk.release = resolve))
  // Every test starts before the list was ever requested; `doMock` makes the factory run again.
  vi.resetModules()
  vi.doMock('gemoji', async () => {
    chunk.requested += 1
    await chunk.ready
    return {
      gemoji: [
        { emoji: '❌', names: ['x'] },
        { emoji: '😄', names: ['smile'] },
      ],
    }
  })
  ;({ createTestEditor, settle, typeText } = await import('./test-editor'))
})

afterEach(() => {
  for (const dispose of created.splice(0)) dispose()
})

function create(markdown = '') {
  const t = createTestEditor(markdown)
  created.push(() => t.editor.dispose())
  return t
}

async function release(): Promise<void> {
  chunk.release()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await settle()
}

describe('first use after page load', () => {
  it('starts loading at the first colon typed into an empty block', async () => {
    const t = create()
    expect(chunk.requested).toBe(0)
    await typeText(t.editor, ':')
    expect(chunk.requested).toBe(1)
  })

  it('does not load for text without a colon', async () => {
    const t = create()
    await typeText(t.editor, 'plain')
    expect(chunk.requested).toBe(0)
  })

  it('converts a closing colon typed before the list arrived', async () => {
    const t = create()
    await typeText(t.editor, ':x:')
    expect(t.markdown()).toBe(':x:')
    await release()
    expect(t.markdown()).toBe('❌')
  })

  it('converts when more text was typed meanwhile and keeps the caret after it', async () => {
    const t = create()
    await typeText(t.editor, 'a :smile: b')
    await release()
    await typeText(t.editor, 'c')
    expect(t.markdown()).toBe('a 😄 bc')
  })

  it('leaves the text alone when the shortcode changed meanwhile', async () => {
    const t = create()
    await typeText(t.editor, ':x:')
    t.editor.update(() => $getRoot().getAllTextNodes()[0]!.spliceText(1, 1, 'y'), { discrete: true })
    await release()
    expect(t.markdown()).toBe(':y:')
  })
})
