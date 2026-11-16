import { buildEditorFromExtensions } from '@lexical/extension'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS as STOCK_TRANSFORMERS,
  type Transformer,
} from '@lexical/markdown'
import { defineExtension, type LexicalEditorWithDispose } from 'lexical'
import { MarkdownNodesExtension } from './extension'

export const TRANSFORMERS: Transformer[] = [...STOCK_TRANSFORMERS]

// shouldPreserveNewLines keeps each source line as its own paragraph, so Enter in
// the editor writes a single "\n" and untouched text keeps its line structure.
export function $importMarkdown(markdown: string, transformers: Transformer[] = TRANSFORMERS): void {
  $convertFromMarkdownString(markdown, transformers, undefined, true, false)
}

export function $exportMarkdown(transformers: Transformer[] = TRANSFORMERS): string {
  return $convertToMarkdownString(transformers, undefined, true)
}

export function createMarkdownEditor(): LexicalEditorWithDispose {
  return buildEditorFromExtensions(
    defineExtension({
      name: 'kept/markdown-editor',
      dependencies: [MarkdownNodesExtension],
      // Lexical logs and swallows errors by default; tests and the fidelity guard need them thrown.
      onError: (error) => {
        throw error
      },
    }),
  )
}

export function roundTrip(markdown: string, transformers: Transformer[] = TRANSFORMERS): string {
  const editor = createMarkdownEditor()
  editor.update(() => $importMarkdown(markdown, transformers), { discrete: true })
  const exported = editor.read(() => $exportMarkdown(transformers))
  editor.dispose()
  return exported
}
