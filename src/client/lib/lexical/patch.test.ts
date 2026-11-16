import { $convertToMarkdownString, setPlainTextEscaper } from '@lexical/markdown'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownEditor } from './markdown'

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
  afterEach(() => setPlainTextEscaper(null))

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
