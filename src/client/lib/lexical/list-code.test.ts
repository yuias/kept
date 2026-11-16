import { $createCodeNode, $isCodeNode } from '@lexical/code-core'
import { $createListItemNode, $createListNode, $isListNode } from '@lexical/list'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { describe, expect, it } from 'vitest'
import { classifyRoundTrip } from './fidelity'
import { $exportMarkdown, $importMarkdown, createMarkdownEditor, roundTrip } from './markdown'

/** Imports `markdown`, runs `edit` on the document, and returns the exported markdown. */
function exportAfter(markdown: string, edit: () => void): string {
  const editor = createMarkdownEditor()
  editor.update(
    () => {
      $importMarkdown(markdown)
      edit()
    },
    { discrete: true },
  )
  const exported = editor.read(() => $exportMarkdown())
  editor.dispose()
  return exported
}

const removeLists = () => $getRoot().getChildren().filter($isListNode).forEach((list) => list.remove())

describe('fenced code inside list items', () => {
  it.each([
    ['without blank lines', '- item\n    ```\n    code in item\n    ```\n- next\n'],
    ['in an ordered list, with a blank line in the code', '1. item\n\n   ```js\n   let a = 1\n\n   b\n   ```\n\n2. next\n'],
    ['in a nested list', '- a\n    - b\n\n        ```\n        x\n        ```\n'],
  ])('round-trips identically: %s', (_name, source) => {
    expect(roundTrip(source)).toBe(source)
  })

  it('keeps a code line indented less than its fence as a fixed point', () => {
    const source = '- item\n\n    ```\n  short\n    ```\n'
    const output = roundTrip(source)
    expect(classifyRoundTrip(source, output)).toBe('render-equal')
    expect(roundTrip(output)).toBe(output)
  })

  it('writes no indent once the list is removed', () => {
    const output = exportAfter('- item\n    ```\n    x\n    ```\n', removeLists)
    expect(output.startsWith('```\nx\n```')).toBe(true)
  })

  it('writes no indent when a paragraph with text now precedes the block', () => {
    const output = exportAfter('- item\n\n    ```\n    x\n    ```\n', () => {
      const code = $getRoot().getChildren().find($isCodeNode)!
      code.insertBefore($createParagraphNode().append($createTextNode('text')))
    })
    expect(output).toBe('- item\n\ntext\n```\nx\n```\n')
    expect(output).not.toMatch(/^ +/m)
  })

  it('indents a tilde fence, written back as a backtick fence', () => {
    expect(roundTrip('- item\n\n    ~~~\n    x\n    ~~~\n')).toBe('- item\n\n    ```\n    x\n    ```\n')
  })

  it('keeps the indent through empty paragraphs between the list and the block', () => {
    const output = exportAfter('- item\n\n\n    ```\n    x\n    ```\n', () => {})
    expect(output).toContain('\n    ```\n    x\n    ```')
  })
})

describe('lines between a list and its fence', () => {
  it.each([
    ['a whitespace-only line', '- item\n  \n    ```\n    x\n    ```\n'],
    ['a tab-only line', '- item\n\t\n    ```\n    x\n    ```\n'],
    ['a paragraph indented as far as the fence', '- item\n    more\n    ```\n    x\n    ```\n'],
    ['a paragraph indented further than the fence', '- item\n      more\n    ```\n    x\n    ```\n'],
    ['an empty line and an indented paragraph', '- item\n\n    more\n\n    ```\n    x\n    ```\n'],
    ['a fence after a nested list', '- item\n    - nested\n  \n    ```\n    x\n    ```\n'],
  ])('keeps the indent behind %s', (_name, source) => {
    expect(roundTrip(source)).toBe(source)
  })

  it('does not keep the indent behind a paragraph that is indented less than the fence', () => {
    expect(roundTrip('- item\n\n  more\n    ```\n    x\n    ```\n')).toBe('- item\n\n  more\n```\nx\n```\n')
    expect(roundTrip('- item\n\ntext\n    ```\n    x\n    ```\n')).toBe('- item\n\ntext\n```\nx\n```\n')
  })

  it('keeps the empty lines before the closing fence together with the indent', () => {
    const source = '- item\n\n    ```\n    x\n\n    ```\n'
    expect(roundTrip(source)).toBe(source)
  })
})

describe('fenced code that was not inside a list', () => {
  it('has no indent for a code block built after a list in the editor', () => {
    const editor = createMarkdownEditor()
    editor.update(
      () => {
        const code = $createCodeNode().append($createTextNode('x'))
        $getRoot().clear().append($createListNode('bullet').append($createListItemNode().append($createTextNode('a'))), code)
      },
      { discrete: true },
    )
    const output = editor.read(() => $exportMarkdown())
    editor.dispose()
    expect(output).not.toMatch(/^ /m)
    expect(output).toContain('```\nx\n```')
  })

  it('drops the indent of a block moved behind a paragraph', () => {
    const output = exportAfter('- item\n\n    ```\n    x\n    ```\n', () => {
      const code = $getRoot().getChildren().find($isCodeNode)!
      const paragraph = $createParagraphNode().append($createTextNode('para'))
      code.insertAfter(paragraph)
      code.remove()
      paragraph.insertAfter(code)
    })
    expect(output).not.toMatch(/^ /m)
    const reloaded = createMarkdownEditor()
    reloaded.update(() => $importMarkdown(output), { discrete: true })
    expect(reloaded.read(() => $getRoot().getChildren().some($isCodeNode))).toBe(true)
    reloaded.dispose()
  })

  it('does not indent a fenced block after a paragraph, even with an indented fence', () => {
    const source = 'para\n\n  ```\n  x\n  ```\n'
    const output = roundTrip(source)
    expect(output).not.toMatch(/^ /m)
    expect(output).toContain('```\nx\n```')
  })

  it('keeps a block with no indent unindented after a list', () => {
    const source = '- item\n\n```\nx\n```\n'
    expect(roundTrip(source)).toBe(source)
  })
})
