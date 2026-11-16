import { $isAutoLinkNode, $isLinkNode, type LinkNode } from '@lexical/link'
import { $dfs } from '@lexical/utils'
import { $parseSerializedNode, type TextNode } from 'lexical'
import { describe, expect, it } from 'vitest'
import { $exportMarkdown, roundTrip } from './markdown'
import { KeptAutoLinkNode, KeptLinkNode } from './nodes/link-nodes'
import { createTestEditor, settle, typeText } from './test-editor'

const fixtures = (files: Record<string, string>): string[] => Object.values(files)
const linkSources = fixtures(
  import.meta.glob(['./fixtures/identical/links.md', './fixtures/identical/bare-urls.md'], { query: '?raw', import: 'default', eager: true }),
)

/** `$nodesOfType` matches the exact class, so subclasses are collected by walking the tree. */
const $links = (): LinkNode[] => $dfs().map(({ node }) => node).filter($isLinkNode)

describe('link node replacements', () => {
  it('found the link fixtures', () => {
    expect(linkSources).toHaveLength(2)
  })

  for (const [index, source] of linkSources.entries()) {
    it(`imports fixture ${index} as Kept link nodes only and exports like the stock editor`, () => {
      const { editor, markdown } = createTestEditor(source)
      const nodes = editor.read(() => $links())
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        expect([KeptLinkNode, KeptAutoLinkNode].some((klass) => node instanceof klass), node.constructor.name).toBe(true)
      }
      expect(markdown()).toBe(roundTrip(source))
      editor.dispose()
    })
  }

  it('keeps the subclass and URL when text is typed inside a link', async () => {
    const { editor, markdown } = createTestEditor('[abc](https://a.example)')
    editor.update(
      () => {
        const link = $links()[0]!
        const text = link.getWritable().getFirstChild() as TextNode
        text.select(1, 1).insertText('x')
      },
      { discrete: true },
    )
    await settle()
    const [link] = editor.read(() => $links())
    expect(link).toBeInstanceOf(KeptLinkNode)
    expect(editor.read(() => link!.getLatest().getURL())).toBe('https://a.example')
    expect(markdown()).toBe('[axbc](https://a.example)')
    editor.dispose()
  })

  it('keeps the subclass when typing turns a URL into an auto link', async () => {
    const { editor, markdown } = createTestEditor('')
    await typeText(editor, 'see https://a.example ')
    const links = editor.read(() => $links().filter($isAutoLinkNode))
    expect(links).toHaveLength(1)
    expect(links[0]).toBeInstanceOf(KeptAutoLinkNode)
    expect(markdown()).toBe('see https://a.example ')
    editor.dispose()
  })

  it('keeps the unlinked flag when an auto link is replaced', () => {
    const { editor } = createTestEditor('https://a.example')
    editor.update(() => $links().filter($isAutoLinkNode)[0]!.setIsUnlinked(true), { discrete: true })
    const [link] = editor.read(() => $links().filter($isAutoLinkNode))
    expect(link).toBeInstanceOf(KeptAutoLinkNode)
    expect(editor.read(() => link!.getLatest().getIsUnlinked())).toBe(true)
    editor.dispose()
  })

  it('keeps the subclass through editor state JSON', () => {
    const { editor, markdown } = createTestEditor('[a](https://a.example) https://b.example')
    const json = JSON.stringify(editor.getEditorState().toJSON())
    expect(json).toContain('"type":"kept-link"')
    expect(json).toContain('"type":"kept-autolink"')
    const other = createTestEditor('')
    other.editor.setEditorState(other.editor.parseEditorState(json), { discrete: true } as never)
    const classes = other.editor.read(() => $links().map((node) => node.constructor.name))
    expect(new Set(classes)).toEqual(new Set(['KeptLinkNode', 'KeptAutoLinkNode']))
    expect(other.markdown()).toBe(markdown())
    editor.dispose()
    other.editor.dispose()
  })

  it('keeps the subclass when nodes are copied by JSON', () => {
    const { editor } = createTestEditor('[a](https://a.example) https://b.example')
    editor.update(
      () => {
        const copies = $links().map((node) => $parseSerializedNode(node.exportJSON()))
        expect(copies.map((node) => node.constructor.name)).toEqual(['KeptLinkNode', 'KeptAutoLinkNode'])
      },
      { discrete: true },
    )
    editor.dispose()
  })

  it('is still a LinkNode for the markdown helpers', () => {
    const { editor } = createTestEditor('[a](https://a.example)')
    editor.read(() => {
      const link = $links()[0]!
      expect($isLinkNode(link)).toBe(true)
      expect($isAutoLinkNode(link)).toBe(false)
      expect($exportMarkdown()).toBe('[a](https://a.example)')
    })
    editor.dispose()
  })
})

/** A stand-in for the anchor element; the test environment has no DOM. */
function fakeAnchor(tagName: string) {
  const attributes = new Map<string, string>()
  return {
    nodeType: 1,
    tagName,
    attributes,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    set href(value: string) {
      attributes.set('href', value)
    },
    set target(value: string) {
      attributes.set('target', value)
    },
    set rel(value: string) {
      attributes.set('rel', value)
    },
    set title(value: string) {
      attributes.set('title', value)
    },
  }
}

describe('link anchors', () => {
  const href = (url: string, anchor = fakeAnchor('A'), prev: KeptLinkNode | null = null) => {
    const { editor } = createTestEditor('')
    editor.update(
      () => {
        const node = new KeptLinkNode(url)
        node.updateLinkDOM(prev, anchor as unknown as HTMLElement, editor._config)
      },
      { discrete: true },
    )
    editor.dispose()
    return anchor.attributes.get('href')
  }

  it('writes href for allowed targets only', () => {
    expect(href('https://a.example/x')).toBe('https://a.example/x')
    expect(href('mailto:a@b.example')).toBe('mailto:a@b.example')
    expect(href('www.a.example')).toBe('http://www.a.example')
    expect(href('a@b.example')).toBe('mailto:a@b.example')
    expect(href('javascript:alert(1)')).toBeUndefined()
    expect(href('ftp://e.example')).toBeUndefined()
    expect(href('/relative')).toBeUndefined()
  })

  it('removes a stale href when the URL changes to a disallowed target', () => {
    const anchor = fakeAnchor('A')
    anchor.attributes.set('href', 'https://a.example')
    const { editor } = createTestEditor('')
    editor.update(
      () => {
        const prev = new KeptLinkNode('https://a.example')
        new KeptLinkNode('ftp://e.example').updateLinkDOM(prev, anchor as unknown as HTMLElement, editor._config)
      },
      { discrete: true },
    )
    editor.dispose()
    expect(anchor.attributes.has('href')).toBe(false)
  })

  it('leaves an unlinked auto link span without href', () => {
    const span = fakeAnchor('SPAN')
    const { editor } = createTestEditor('')
    editor.update(
      () => new KeptAutoLinkNode('https://a.example', { isUnlinked: true }).updateLinkDOM(null, span as unknown as HTMLElement, editor._config),
      { discrete: true },
    )
    editor.dispose()
    expect(span.attributes.has('href')).toBe(false)
  })
})
