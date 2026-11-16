import { buildEditorFromExtensions } from '@lexical/extension'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  HIGHLIGHT,
  setPlainTextEscaper,
  TRANSFORMERS as STOCK_TRANSFORMERS,
  type Transformer,
} from '@lexical/markdown'
import { $isAutoLinkNode, $isLinkNode } from '@lexical/link'
import {
  $isLineBreakNode,
  $isTextNode,
  defineExtension,
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  type LexicalEditorWithDispose,
  type LexicalNode,
} from 'lexical'
import { type Edge, escapePlainText } from './escape'
import { MarkdownNodesExtension } from './extension'
import { CODE_SPAN, PARAGRAPH_LINE_START } from './transformers'

// Highlight (`==x==`) cannot be stored in markdown that GitHub-style readers
// understand, so it stays plain text.
export const TRANSFORMERS: Transformer[] = [
  ...STOCK_TRANSFORMERS.filter((transformer) => transformer !== HIGHLIGHT),
  CODE_SPAN,
  PARAGRAPH_LINE_START,
]

// Characters the exporter writes around text with these formats. Underline and
// the like have no markdown spelling and write nothing.
const delimiterOf = (format: number): string =>
  (format & (IS_BOLD | IS_ITALIC) ? '*' : '') + (format & IS_STRIKETHROUGH ? '~' : '') + (format & IS_CODE ? '`' : '')

// What the exporter writes next to a text node: the adjacent character of a
// plain neighbour, a newline for a line break, nothing at a block edge, and the
// delimiter characters of formatted text, code and links.
function edge(sibling: LexicalNode | null, last: boolean): Edge {
  if (!sibling) return ''
  if ($isLineBreakNode(sibling)) return '\n'
  const delimiter = $isTextNode(sibling) ? delimiterOf(sibling.getFormat()) : $isLinkNode(sibling) && !$isAutoLinkNode(sibling) ? (last ? ')' : '[') : ''
  if (delimiter) return { delimiter }
  return (last ? /.$/su : /^./su).exec(sibling.getTextContent())?.[0] ?? ''
}

// The stock exporter escapes every `*_`~` in preserve-newlines mode; this
// escapes only what the importer would read as markup (see escape.ts). A
// formatted node is wrapped in delimiters itself, so both its edges are
// delimiter edges.
setPlainTextEscaper((text, node) => {
  const own = delimiterOf(node.getFormat())
  return own
    ? escapePlainText(text, { delimiter: own }, { delimiter: own })
    : escapePlainText(text, edge(node.getPreviousSibling(), true), edge(node.getNextSibling(), false))
})

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
