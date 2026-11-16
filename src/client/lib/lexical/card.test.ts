import { $createLinkNode } from '@lexical/link'
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalNode } from 'lexical'
import { describe, expect, it } from 'vitest'
import { $exportMarkdown, $importMarkdown, createMarkdownEditor, roundTrip } from './markdown'
import { $createCardNode, $isCardNode } from './nodes/card-node'
import { $createImageNode } from './nodes/image-node'

/** Imports `markdown` and returns the type of every root child, with the url for cards. */
function rootShape(markdown: string): string[] {
  const editor = createMarkdownEditor()
  editor.update(() => $importMarkdown(markdown), { discrete: true })
  const shape = editor.read(() =>
    $getRoot().getChildren().map((node) => ($isCardNode(node) ? `card ${node.getURL()}` : node.getType())),
  )
  editor.dispose()
  return shape
}

/** Exports a document built from `build`, then reloads the markdown and reports its shape. */
function exportAndReload(build: () => LexicalNode[]): { markdown: string; shape: string[] } {
  const editor = createMarkdownEditor()
  editor.update(() => $getRoot().clear().append(...build()), { discrete: true })
  const markdown = editor.read(() => $exportMarkdown())
  editor.dispose()
  return { markdown, shape: rootShape(markdown) }
}

describe('card node', () => {
  it('imports a card line as a root child with its url', () => {
    expect(rootShape('@[card](https://a.example)')).toEqual(['card https://a.example'])
  })

  it('keeps every url form of the app, including percent-encoded parentheses', () => {
    const source = '@[card](https://e.example/wiki/Foo_%28bar%29)\n@[card](https://e.example/wiki/Foo_(bar))'
    expect(rootShape(source)).toEqual([
      'card https://e.example/wiki/Foo_%28bar%29',
      'card https://e.example/wiki/Foo_(bar)',
    ])
    expect(roundTrip(source)).toBe(source)
  })

  it.each([
    '@[card](ftp://x)',
    '@[card](/relative)',
    '- @[card](https://a.example)',
    '> @[card](https://a.example)',
    ' @[card](https://a.example)',
    'a @[card](https://a.example)',
    '@[card](https://a.example) b',
    '```\n@[card](https://a.example)\n```',
  ])('does not make a card of %j', (source) => {
    expect(rootShape(source)).not.toContain('card https://a.example')
    expect(rootShape(source).some((type) => type.startsWith('card'))).toBe(false)
    expect(roundTrip(source)).toBe(source)
  })

  it('restores a declined card line instead of cutting its prefix', () => {
    expect(roundTrip('@[card](ftp://x)')).toBe('@[card](ftp://x)')
    expect(roundTrip('x\n@[card](ftp://x)\n@[card](https://a.example)')).toBe('x\n@[card](ftp://x)\n@[card](https://a.example)')
  })

  it('drops trailing spaces and tabs of a card line', () => {
    expect(roundTrip('@[card](https://a.example)  \t\nb')).toBe('@[card](https://a.example)\nb')
  })

  it('keeps card lines joined with a single newline next to paragraphs and cards', () => {
    const source = 'a\n@[card](https://a.example)\n@[card](https://b.example)\nb\n\n@[card](https://c.example)\n'
    expect(roundTrip(source)).toBe(source)
  })

  it('exports as its markdown text', () => {
    const editor = createMarkdownEditor()
    editor.update(() => $getRoot().clear().append($createCardNode('https://a.example')), { discrete: true })
    expect(editor.read(() => $getRoot().getTextContent())).toBe('@[card](https://a.example)')
    expect(editor.read(() => $exportMarkdown())).toBe('@[card](https://a.example)')
    editor.dispose()
  })

  it('keeps editor-built cards, text, links and images apart on reload', () => {
    const { markdown, shape } = exportAndReload(() => [
      $createParagraphNode().append($createTextNode('before')),
      $createCardNode('https://a.example'),
      $createParagraphNode().append($createTextNode('see '), $createImageNode('/img/x', 'x')),
      $createCardNode('https://b.example/wiki/Foo_(bar)'),
    ])
    expect(markdown).toBe('before\n@[card](https://a.example)\nsee ![x](/img/x)\n@[card](https://b.example/wiki/Foo_(bar))')
    expect(shape).toEqual(['paragraph', 'card https://a.example', 'paragraph', 'card https://b.example/wiki/Foo_(bar)'])
  })

  it('escapes typed text and a link that would write a card line', () => {
    const link = () => $createLinkNode('https://a.example').append($createTextNode('card'))
    const typedLink = exportAndReload(() => [$createParagraphNode().append($createTextNode('@'), link())])
    expect(typedLink.markdown).toBe('\\@[card](https://a.example)')
    expect(typedLink.shape).toEqual(['paragraph'])
    const typedText = exportAndReload(() => [$createParagraphNode().append($createTextNode('@[card](https://a.example)'))])
    expect(typedText.shape).toEqual(['paragraph'])
    const reloaded = roundTrip(typedText.markdown)
    expect(reloaded).toBe(typedText.markdown)
    // A line that cannot be a card keeps its bytes.
    expect(exportAndReload(() => [$createParagraphNode().append($createTextNode('@'), $createLinkNode('ftp://x').append($createTextNode('card')))]).markdown).toBe('@[card](ftp://x)')
    expect(exportAndReload(() => [$createParagraphNode().append($createTextNode('b '), link())]).markdown).toBe('b [card](https://a.example)')
  })
})
