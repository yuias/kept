import { $convertToMarkdownString, setPlainTextEscaper } from '@lexical/markdown'
import { $createParagraphNode, $createTextNode, $getRoot, $isTextNode, IS_BOLD, type ParagraphNode } from 'lexical'
import { beforeEach, describe, expect, it } from 'vitest'
import { $importMarkdown, createMarkdownEditor, roundTrip } from './markdown'

// Exports one paragraph with a plain and an inline-code text node, preserving new lines.
function exportParagraph(): string {
  const editor = createMarkdownEditor()
  editor.update(
    () => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode('a_b'), $createTextNode('c_d').toggleFormat('code'))
      $getRoot().clear().append(paragraph)
    },
    { discrete: true },
  )
  const markdown = editor.read(() => $convertToMarkdownString(undefined, undefined, true))
  editor.dispose()
  return markdown
}

describe('plain-text escaper hook of the patched @lexical/markdown', () => {
  beforeEach(() => setPlainTextEscaper(null))

  it('keeps the stock escaping while no escaper is installed', () => {
    expect(exportParagraph()).toBe('a\\_b`c_d`')
  })

  it('exports plain text through the installed escaper', () => {
    setPlainTextEscaper((text) => `<${text}>`)
    expect(exportParagraph()).toBe('<a_b>`c_d`')
  })

  it('restores the stock escaping when the escaper is removed', () => {
    setPlainTextEscaper((text) => `<${text}>`)
    setPlainTextEscaper(null)
    expect(exportParagraph()).toBe('a\\_b`c_d`')
  })
})

describe('emphasis flanking of the patched importer', () => {
  // `、` and `"` are punctuation to CommonMark, so `**` between them opens and closes bold.
  it.each([
    ['a、**"b"** c', ['a、', '"b"', ' c']],
    ['「**"b"**」', ['「', '"b"', '」']],
  ])('reads %j with a non-ASCII punctuation neighbour as bold', (source, texts) => {
    const editor = createMarkdownEditor()
    editor.update(() => $importMarkdown(source), { discrete: true })
    const nodes = editor.read(() => ($getRoot().getFirstChild() as ParagraphNode).getChildren().filter($isTextNode).map((node): [string, number] => [node.getTextContent(), node.getFormat()]))
    editor.dispose()
    expect(nodes.map(([text]) => text)).toEqual(texts)
    expect(nodes.filter(([, format]) => format === IS_BOLD)).toHaveLength(1)
    expect(roundTrip(source)).toBe(source)
  })
})
