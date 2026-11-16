import { $isListItemNode, $isListNode, $createListItemNode, $createListNode, type ListNode } from '@lexical/list'
import { $createTextNode, $getRoot, type LexicalNode } from 'lexical'
import { describe, expect, it } from 'vitest'
import { classifyRoundTrip } from './fidelity'
import { $exportMarkdown, $importMarkdown, createMarkdownEditor, roundTrip } from './markdown'

type Shape = [type: string, start: number, items: (string | Shape)[]]

/** Lists as nested data: type, start, and per item its text or its sublist. */
const listShape = (list: ListNode): Shape => [
  list.getListType(),
  list.getStart(),
  list.getChildren().map((item) => {
    if (!$isListItemNode(item)) throw new Error('not a list item')
    const nested = item.getFirstChild()
    return $isListNode(nested) ? listShape(nested) : item.getTextContent()
  }),
]

const shapeOf = (markdown: string): Shape[] => {
  const editor = createMarkdownEditor()
  editor.update(() => $importMarkdown(markdown), { discrete: true })
  const shapes = editor.read(() => $getRoot().getChildren().filter($isListNode).map(listShape))
  editor.dispose()
  return shapes
}

const item = (text: string, sublist?: ListNode): LexicalNode[] => [
  $createListItemNode().append($createTextNode(text)),
  ...(sublist ? [$createListItemNode().append(sublist)] : []),
]

/** Builds the lists the way the editor does, exports them, and returns the markdown and its reimported shape. */
function buildAndReload(build: () => ListNode[]): { markdown: string; built: Shape[]; reloaded: Shape[] } {
  const editor = createMarkdownEditor()
  editor.update(() => $getRoot().clear().append(...build()), { discrete: true })
  const markdown = editor.read(() => $exportMarkdown())
  const built = editor.read(() => $getRoot().getChildren().filter($isListNode).map(listShape))
  editor.dispose()
  return { markdown, built, reloaded: shapeOf(markdown) }
}

describe('nested bullet lists in the source', () => {
  it.each(['- a\n  - b\n', '- a\n   - b\n', '- a\n\t- b\n'])('reads %j as a nested list and writes four spaces', (source) => {
    expect(roundTrip(source)).toBe('- a\n    - b\n')
    expect(classifyRoundTrip(source, roundTrip(source))).toBe('render-equal')
  })
})

describe('known differences left to the fidelity guard', () => {
  it('loses the start of a nested ordered list', () => {
    const output = roundTrip('3. a\n   1. b\n')
    expect(output).toBe('3. a\n    3. b\n')
    expect(classifyRoundTrip('3. a\n   1. b\n', output)).toBe('render-different')
  })

  it('writes the items of one list with one marker', () => {
    const output = roundTrip('* a\n+ b\n')
    expect(output).toBe('+ a\n+ b\n')
    expect(classifyRoundTrip('* a\n+ b\n', output)).toBe('render-different')
  })
})

describe('bullet markers', () => {
  it.each(['-', '*', '+'])('keeps %s on a list that is edited', (marker) => {
    const source = `${marker} a\n${marker} b\n`
    const editor = createMarkdownEditor()
    editor.update(
      () => {
        $importMarkdown(source)
        const list = $getRoot().getFirstChild() as ListNode
        list.append($createListItemNode().append($createTextNode('c')), $createListItemNode().append($createTextNode('d')))
        ;(list.getLastChild() as ReturnType<typeof $createListItemNode>).setIndent(1)
      },
      { discrete: true },
    )
    const markdown = editor.read(() => $exportMarkdown())
    editor.dispose()
    // A sublist made by indenting is a new list, written with `-`.
    expect(markdown).toBe(`${marker} a\n${marker} b\n${marker} c\n    - d\n`)
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it.each(['* a\n    + b\n', '+ a\n    * b\n    * c\n', '1. a\n    * b\n', '- a\n\n- b\n', '* a\n\n+ b\n', '* a\n* b\n\n\n+ c\n'])(
    'keeps the markers of %j',
    (source) => {
      expect(roundTrip(source)).toBe(source)
    },
  )
})

describe('lists made in the editor', () => {
  const cases: Record<string, [build: () => ListNode[], markdown: string]> = {
    'three bullet levels': [
      () => [$createListNode('bullet').append(...item('a', $createListNode('bullet').append(...item('b', $createListNode('bullet').append(...item('c'))))), ...item('d'))],
      '- a\n    - b\n        - c\n- d',
    ],
    'ordered from 5': [() => [$createListNode('number', 5).append(...item('a'), ...item('b'))], '5. a\n6. b'],
    'ordered from 0': [() => [$createListNode('number', 0).append(...item('a'), ...item('b'))], '0. a\n1. b'],
    'bullets under an ordered item': [() => [$createListNode('number', 3).append(...item('a', $createListNode('bullet').append(...item('b'))))], '3. a\n    - b'],
    'an ordered list under a bullet': [
      () => [$createListNode('bullet').append(...item('a', $createListNode('number', 4).append(...item('b'), ...item('c'))))],
      '- a\n    4. b\n    5. c',
    ],
    'nested tasks': [() => [$createListNode('check').append(...item('a', $createListNode('check').append(...item('b'))))], '- [ ] a\n    - [ ] b'],
    'empty items': [() => [$createListNode('bullet').append(...item(''), ...item('b'))], '- \n- b'],
    'a bullet list followed by an ordered list': [
      () => [$createListNode('bullet').append(...item('a')), $createListNode('number', 1).append(...item('b'))],
      '- a\n1. b',
    ],
  }

  it.each(Object.entries(cases))('%s reloads with the same structure', (_name, [build, markdown]) => {
    const result = buildAndReload(build)
    expect(result.markdown).toBe(markdown)
    expect(result.reloaded).toEqual(result.built)
    expect(roundTrip(result.markdown)).toBe(result.markdown)
  })
})
