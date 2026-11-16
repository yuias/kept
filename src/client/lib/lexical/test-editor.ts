import { buildEditorFromExtensions, configExtension, defineExtension } from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
  type LexicalEditorWithDispose,
} from 'lexical'
import { RichEditorExtension } from './core'
import { $exportMarkdown, $importMarkdown } from './markdown'

/** Shared helpers for tests that drive a headless editor built from `RichEditorExtension`. */
export interface TestEditor {
  editor: LexicalEditorWithDispose
  /** Moves the history clock past the merge delay, so the next change is a new undo step. */
  tick(): void
  markdown(): string
}

/** History is off without a window; the injected clock makes undo steps deterministic. */
export function createTestEditor(markdown = ''): TestEditor {
  let clock = 0
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'kept/test-editor',
      dependencies: [RichEditorExtension, configExtension(HistoryExtension, { disabled: false, now: () => clock })],
      onError: (error) => {
        throw error
      },
    }),
  )
  editor.update(
    () => {
      $importMarkdown(markdown)
      if ($getRoot().isEmpty()) $getRoot().append($createParagraphNode())
      $getRoot().selectEnd()
    },
    { discrete: true },
  )
  return {
    editor,
    tick: () => void (clock += 1000),
    markdown: () => editor.read(() => $exportMarkdown()),
  }
}

/** Lets the nested update that a shortcut schedules from its update listener commit. */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Types one character per update, as the browser does. */
export async function typeText(editor: LexicalEditorWithDispose, text: string): Promise<void> {
  for (const char of text) {
    editor.update(
      () => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.insertText(char)
      },
      { discrete: true },
    )
    await settle()
  }
}

export async function pressEnter(editor: LexicalEditorWithDispose): Promise<void> {
  editor.dispatchCommand(KEY_ENTER_COMMAND, null)
  await settle()
}
