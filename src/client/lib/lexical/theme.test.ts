import { buildEditorFromExtensions } from '@lexical/extension'
import { defineExtension } from 'lexical'
import { describe, expect, it } from 'vitest'
import { MarkdownNodesExtension } from './extension'
import { theme } from './theme'

// Node types every editor has, whatever the extensions register.
const CORE_TYPES = new Set(['root', 'text', 'linebreak', 'tab', 'paragraph', 'artificial'])

// Where each registered node type finds its class in the theme.
const themeKeyOf: Record<string, string> = {
  paragraph: 'paragraph',
  heading: 'heading.h1',
  quote: 'quote',
  code: 'code',
  horizontalrule: 'hr',
  link: 'link',
  autolink: 'link',
  list: 'list.ul',
  listitem: 'list.listitem',
  table: 'table',
  tablerow: 'tableRow',
  tablecell: 'tableCell',
  'kept-image': 'image',
  'kept-card': 'card',
}

const lookup = (path: string): unknown =>
  path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], theme)

describe('editor theme', () => {
  it('has a class for every node type of the markdown nodes', () => {
    const editor = buildEditorFromExtensions(defineExtension({ name: 'theme-test', dependencies: [MarkdownNodesExtension] }))
    const types = [...editor._nodes.keys()].filter((type) => !CORE_TYPES.has(type))
    editor.dispose()
    expect(types.length).toBeGreaterThan(0)
    expect(types.filter((type) => !(type in themeKeyOf))).toEqual([])
    for (const type of types) expect(lookup(themeKeyOf[type]!), type).toEqual(expect.any(String))
  })

  it('has a class for each heading level, list kind, task state, and table cell kind', () => {
    for (const key of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) expect(theme.heading?.[key as 'h1']).toEqual(expect.any(String))
    for (const path of [
      'list.ul',
      'list.ol',
      'list.checklist',
      'list.listitemChecked',
      'list.listitemUnchecked',
      'list.nested.listitem',
      'tableCellHeader',
      'tableScrollableWrapper',
    ]) {
      expect(lookup(path), path).toEqual(expect.any(String))
    }
  })

  it('has a class for bold, italic, strikethrough, and code', () => {
    for (const format of ['bold', 'italic', 'strikethrough', 'code'] as const) {
      expect(theme.text?.[format], format).toEqual(expect.any(String))
    }
  })
})
