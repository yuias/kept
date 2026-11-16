import { $createLinkNode, $isLinkNode } from '@lexical/link'
import { $createParagraphNode, $createTextNode, $getRoot, $isParagraphNode, type LexicalNode } from 'lexical'
import { describe, expect, it } from 'vitest'
import { classifyRoundTrip } from './fidelity'
import { $exportMarkdown, $importMarkdown, createMarkdownEditor, roundTrip } from './markdown'
import { $createImageNode, $isImageNode } from './nodes/image-node'

const PLACEHOLDER = '![uploading-00000000-0000-0000-0000-000000000000]()'

/** Imports `markdown` and returns the children of the first paragraph. */
function inlineNodes<T>(markdown: string, read: (nodes: LexicalNode[]) => T): T {
  const editor = createMarkdownEditor()
  editor.update(() => $importMarkdown(markdown), { discrete: true })
  const result = editor.read(() => {
    const [block] = $getRoot().getChildren()
    return read($isParagraphNode(block) ? block.getChildren() : [])
  })
  editor.dispose()
  return result
}

/** Exports and re-imports a paragraph built from `build`, returning the markdown and the reloaded node types. */
function exportAndReload(build: () => LexicalNode[]): { markdown: string; types: string[] } {
  const editor = createMarkdownEditor()
  editor.update(() => $getRoot().clear().append($createParagraphNode().append(...build())), { discrete: true })
  const markdown = editor.read(() => $exportMarkdown())
  editor.dispose()
  return { markdown, types: inlineNodes(markdown, (nodes) => nodes.map((n) => n.getType())) }
}

describe('image node', () => {
  it('imports the upload placeholder as one image with an empty src and exports it unchanged', () => {
    const images = inlineNodes(PLACEHOLDER, (nodes) => nodes.map((n) => ($isImageNode(n) ? [n.getSrc(), n.getAlt()] : n.getType())))
    expect(images).toEqual([['', 'uploading-00000000-0000-0000-0000-000000000000']])
    expect(roundTrip(PLACEHOLDER)).toBe(PLACEHOLDER)
  })

  it('keeps the source of any target, including external ones, and the title spelling', () => {
    const read = (markdown: string) =>
      inlineNodes(markdown, (nodes) => nodes.map((n) => ($isImageNode(n) ? [n.getSrc(), n.getAlt(), n.getTitle()] : n.getType())))
    expect(read('![alt](/img/abc "t")')).toEqual([['/img/abc', 'alt', 't']])
    expect(read('![x](https://e.example/a.png)')).toEqual([['https://e.example/a.png', 'x', null]])
    expect(read('![a](/img/abc "")')).toEqual([['/img/abc', 'a', '']])
    expect(roundTrip('![a](/img/abc "")')).toBe('![a](/img/abc "")')
  })

  it('finds several images in a line and keeps the text between them', () => {
    const source = 'x ![a](/img/x) y ![b](/img/y)'
    expect(inlineNodes(source, (nodes) => nodes.map((n) => n.getType()))).toEqual(['text', 'kept-image', 'text', 'kept-image'])
    expect(roundTrip(source)).toBe(source)
  })

  it.each(['`![a](/img/x)`', '```\n![a](/img/x)\n```'])('does not read an image inside code: %s', (source) => {
    const editor = createMarkdownEditor()
    editor.update(() => $importMarkdown(source), { discrete: true })
    const json = JSON.stringify(editor.getEditorState().toJSON())
    editor.dispose()
    expect(json).not.toContain('kept-image')
    expect(roundTrip(source)).toBe(source)
  })

  it('exports an image made in the editor', () => {
    const { markdown } = exportAndReload(() => [$createTextNode('a '), $createImageNode('/img/x', 'pic', 't'), $createTextNode(' b')])
    expect(markdown).toBe('a ![pic](/img/x "t") b')
  })

  it('reads an escaped `!` before a link as text', () => {
    const source = '\\![a](https://e.example)'
    expect(inlineNodes(source, (nodes) => nodes.map((n) => n.getType()))).toEqual(['text', 'link'])
    expect(roundTrip(source)).toBe(source)
  })

  it('escapes a `!` that would join a link into an image, only when the importer would read it as one', () => {
    const link = (url: string) => () => {
      const anchor = $createLinkNode(url)
      anchor.append($createTextNode('a'))
      return [$createTextNode('Wow!'), anchor]
    }
    const plain = exportAndReload(link('https://e.example'))
    expect(plain).toEqual({ markdown: 'Wow\\![a](https://e.example)', types: ['text', 'link'] })
    // `![a](<b c>)` is not an image to the importer, so the bytes stay as they were.
    expect(exportAndReload(link('b c')).markdown).toBe('Wow![a](<b c>)')
    expect(exportAndReload(link('a(b)')).markdown).toBe('Wow![a](a(b))')
  })

  it('tests the destination as the exporter writes it, not the raw URL', () => {
    const link = (before: string, url: string, label: string) => () => {
      const anchor = $createLinkNode(url)
      anchor.append($createTextNode(label))
      return [$createTextNode(before), anchor]
    }
    expect(exportAndReload(link('!', 'a)b', 'x'))).toEqual({ markdown: '\\![x](a\\)b)', types: ['text', 'link'] })
    expect(exportAndReload(link('Wow!', 'https://e.example/x)', 'x'))).toEqual({
      markdown: 'Wow\\![x](https://e.example/x\\))',
      types: ['text', 'link'],
    })
  })

  it.each([
    ['![a](b \'t\')', '![a](b "t")'],
    ['![a](b (t))', '![a](b "t")'],
    ['![a]( b )', '![a](b)'],
    ['![a](b "t" )', '![a](b "t")'],
    ['![a](<b>)', '![a](b)'],
  ])('reads %s as an image and writes it canonically', (source, expected) => {
    expect(inlineNodes(source, (nodes) => nodes.map((n) => n.getType()))).toEqual(['kept-image'])
    expect(roundTrip(source)).toBe(expected)
    expect(roundTrip(expected)).toBe(expected)
    expect(classifyRoundTrip(source, expected)).toBe('render-equal')
  })

  it('keeps an escaped quote in a title, and escapes the quote of a re-quoted one', () => {
    expect(roundTrip('![a](b "t\\"u")')).toBe('![a](b "t\\"u")')
    expect(inlineNodes('![a](b \'x"y\')', (nodes) => nodes.map((n) => ($isImageNode(n) ? n.getTitle() : null)))).toEqual(['x\\"y'])
    expect(roundTrip('![a](b \'x"y\')')).toBe('![a](b "x\\"y")')
  })

  it('leaves destinations with parentheses or in angle brackets to the link reader', () => {
    for (const source of ['![a](b(c))', '![a](<b c>)']) {
      expect(inlineNodes(source, (nodes) => nodes.map((n) => n.getType()))).toEqual(['text', 'link'])
      expect(roundTrip(source)).toBe(source)
    }
  })
})

describe('link destinations', () => {
  it.each([
    '[Wikipedia](https://en.wikipedia.org/wiki/Foo_(bar))',
    '[x](https://e.example/a_(b)_c)',
    '[x](https://e.example/a(b(c(d))))',
    '[x](https://e.example/a?b=1&c=2 "title")',
  ])('writes balanced parentheses raw: %s', (source) => {
    expect(inlineNodes(source, (nodes) => nodes.map((n) => n.getType()))).toEqual(['link'])
    expect(roundTrip(source)).toBe(source)
  })

  it.each([
    ['https://e.example/a)b', '[a](https://e.example/a\\)b)'],
    ['https://e.example/a(b', '[a](https://e.example/a\\(b)'],
    ['https://e.example/a(b(c(d(e))))', '[a](https://e.example/a\\(b\\(c\\(d\\(e\\)\\)\\)\\))'],
    ['https://e.example/a b(c)', '[a](<https://e.example/a b(c)>)'],
    ['https://e.example/a\\b(c)', '[a](https://e.example/a\\\\b\\(c\\))'],
    ['https://e.example/?q=&amp;x(y)', '[a](https://e.example/?q=&#38;amp;x\\(y\\))'],
  ])('leaves %s to the stock export', (url, expected) => {
    const { markdown } = exportAndReload(() => {
      const anchor = $createLinkNode(url)
      anchor.append($createTextNode('a'))
      return [anchor]
    })
    expect(markdown).toBe(expected)
    const urls = inlineNodes(markdown, (nodes) => nodes.map((n) => ($isLinkNode(n) ? n.getURL() : null)))
    expect(urls).toEqual([url])
  })
})
