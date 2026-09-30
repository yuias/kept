import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  type BlockSpec,
  buildBlockDecorations,
  buildPreviewDecorations,
  collectBlockSpecs,
  collectPreviewSpecs,
  isBulletMark,
  localImageSrc,
  taskToggleChange,
} from './blocks'

function stateFor(doc: string, cursor: number | [number, number] = doc.length): EditorState {
  const [anchor, head] = Array.isArray(cursor) ? cursor : [cursor, cursor]
  return EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [new LanguageSupport(markdownLanguage)],
  })
}

function specsFor(doc: string, cursor: number | [number, number] = doc.length): BlockSpec[] {
  return collectBlockSpecs(stateFor(doc, cursor), [{ from: 0, to: doc.length }])
}

const kinds = (specs: BlockSpec[], kind: BlockSpec['kind']): BlockSpec[] => specs.filter((s) => s.kind === kind)
const lineClasses = (specs: BlockSpec[]): string[] =>
  specs.flatMap((s) => (s.kind === 'line' ? [s.className] : []))

describe('localImageSrc', () => {
  it.each(['/img/abc-123', '/img/0f8fad5b_d9cb'])('accepts %s', (url) => {
    expect(localImageSrc(url)).toBe(url)
  })

  it.each([
    'https://example.com/a.png',
    '//example.com/img/a',
    '/img/',
    '/img/a/b',
    '/img/a?x=1',
    '/img/../secret',
    '/other/a',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '',
  ])('rejects %j', (url) => {
    expect(localImageSrc(url)).toBeNull()
  })
})

describe('taskToggleChange', () => {
  it('checks an open box, touching only the inner character', () => {
    expect(taskToggleChange('[ ]', 10)).toEqual({ from: 11, to: 12, insert: 'x' })
  })

  it.each(['[x]', '[X]'])('unchecks %s', (marker) => {
    expect(taskToggleChange(marker, 0)).toEqual({ from: 1, to: 2, insert: ' ' })
  })

  it.each(['[]', '[-]', '[  ]', 'abc', ''])('ignores %j', (marker) => {
    expect(taskToggleChange(marker, 0)).toBeNull()
  })

  it('applied to a document, changes exactly one character', () => {
    const doc = '- [ ] a\r\n- [x] b'
    const state = EditorState.create({ doc, extensions: [EditorState.lineSeparator.of('\n')] })
    const at = doc.indexOf('[ ]')
    const next = state.update({ changes: taskToggleChange('[ ]', at)! }).state.doc.toString()
    expect(next).toBe('- [x] a\r\n- [x] b')
  })
})

describe('isBulletMark', () => {
  it('separates bullets from ordered markers', () => {
    expect(['-', '*', '+'].every(isBulletMark)).toBe(true)
    expect(isBulletMark('1.')).toBe(false)
  })
})

describe('images', () => {
  it('replaces a local image off the cursor line', () => {
    const doc = '![pic](/img/abc)\n\nend'
    expect(kinds(specsFor(doc), 'image')).toEqual([{ kind: 'image', from: 0, to: 16, src: '/img/abc', alt: 'pic' }])
  })

  it('keeps the source and previews below the line when the cursor is on it', () => {
    const doc = 'text ![pic](/img/abc) more\n\nend'
    const state = stateFor(doc, 8)
    expect(kinds(collectBlockSpecs(state, [{ from: 0, to: doc.length }]), 'image')).toEqual([])
    expect(collectPreviewSpecs(state)).toEqual([{ at: 26, src: '/img/abc', alt: 'pic' }])
  })

  it('does not preview images on other lines', () => {
    expect(collectPreviewSpecs(stateFor('![pic](/img/abc)\n\nend'))).toEqual([])
  })

  it('leaves external, empty and upload-placeholder targets as source', () => {
    const doc = '![a](https://example.com/x.png)\n\n![uploading-1]()\n\n![b](//evil/img/x)\n\nend'
    expect(kinds(specsFor(doc), 'image')).toEqual([])
    for (const cursor of [2, 36, 50]) expect(collectPreviewSpecs(stateFor(doc, cursor))).toEqual([])
  })

  it('never replaces across a line break, but previews from the last line', () => {
    const doc = '![a\nb](/img/x)\n\nend'
    expect(kinds(specsFor(doc), 'image')).toEqual([])
    expect(collectPreviewSpecs(stateFor(doc, 1))).toEqual([{ at: 14, src: '/img/x', alt: 'a\nb' }])
    expect(collectPreviewSpecs(stateFor(doc, 6))).toEqual([{ at: 14, src: '/img/x', alt: 'a\nb' }])
  })

  it('renders an image inside a link without duplicates', () => {
    const doc = '[![a](/img/x)](https://example.com)\n\nend'
    expect(kinds(specsFor(doc), 'image')).toHaveLength(1)
  })

  it('previews each image once when several selections touch it', () => {
    const doc = '![a](/img/x) ![b](/img/y)\n\nend'
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(16)]),
      extensions: [new LanguageSupport(markdownLanguage), EditorState.allowMultipleSelections.of(true)],
    })
    expect(collectPreviewSpecs(state)).toHaveLength(2)
  })

  it('skips previews for a very large selection', () => {
    const doc = Array.from({ length: 400 }, () => '![a](/img/x)').join('\n\n')
    expect(collectPreviewSpecs(stateFor(doc, [0, doc.length]))).toEqual([])
  })
})

describe('rules', () => {
  it('replaces a rule off the cursor line and shows it dimmed on it', () => {
    const doc = 'a\n\n---\n\nb'
    expect(kinds(specsFor(doc), 'rule')).toEqual([{ kind: 'rule', from: 3, to: 6 }])
    const onRule = specsFor(doc, 4)
    expect(kinds(onRule, 'rule')).toEqual([])
    expect(kinds(onRule, 'mark')).toEqual([{ kind: 'mark', from: 3, to: 6, className: 'cm-live-marker' }])
  })

  it('does not treat a setext underline as a rule', () => {
    expect(kinds(specsFor('Title\n---\n\nx'), 'rule')).toEqual([])
  })
})

describe('task lists', () => {
  it('turns markers into checkboxes and hides the bullet off the cursor line', () => {
    const doc = '- [ ] one\n- [x] two\n\nend'
    const specs = specsFor(doc)
    expect(kinds(specs, 'checkbox')).toEqual([
      { kind: 'checkbox', from: 2, to: 5, checked: false },
      { kind: 'checkbox', from: 12, to: 15, checked: true },
    ])
    expect(kinds(specs, 'hide')).toEqual([
      { kind: 'hide', from: 0, to: 2 },
      { kind: 'hide', from: 10, to: 12 },
    ])
  })

  it('shows the raw marker on the cursor line only', () => {
    const doc = '- [ ] one\n- [x] two\n\nend'
    const specs = specsFor(doc, 3)
    expect(kinds(specs, 'checkbox')).toEqual([{ kind: 'checkbox', from: 12, to: 15, checked: true }])
    expect(kinds(specs, 'hide')).toEqual([{ kind: 'hide', from: 10, to: 12 }])
  })

  it('keeps the number of an ordered task item', () => {
    const doc = '1. [ ] one\n\nend'
    const specs = specsFor(doc)
    expect(kinds(specs, 'checkbox')).toHaveLength(1)
    expect(kinds(specs, 'hide')).toEqual([])
  })

  it('draws bullets off the cursor line and the raw mark on it', () => {
    const doc = '- a\n* b\n+ c\n\nend'
    const specs = specsFor(doc, 5)
    expect(kinds(specs, 'bullet')).toEqual([
      { kind: 'bullet', from: 0, to: 1 },
      { kind: 'bullet', from: 8, to: 9 },
    ])
    expect(kinds(specs, 'mark')).toEqual([{ kind: 'mark', from: 4, to: 5, className: 'cm-live-list-mark' }])
  })

  it('keeps the number of an ordered item', () => {
    const specs = specsFor('1. a\n\nend')
    expect(kinds(specs, 'bullet')).toEqual([])
    expect(kinds(specs, 'mark')).toEqual([{ kind: 'mark', from: 0, to: 2, className: 'cm-live-list-mark' }])
  })
})

describe('blockquotes', () => {
  it('styles each line and hides marks off the cursor line', () => {
    const doc = '> a\n> b\n\nend'
    const specs = specsFor(doc)
    expect(lineClasses(specs)).toEqual(['cm-live-quote', 'cm-live-quote'])
    expect(kinds(specs, 'hide')).toEqual([
      { kind: 'hide', from: 0, to: 2 },
      { kind: 'hide', from: 4, to: 6 },
    ])
  })

  it('keeps the mark of the cursor line', () => {
    const specs = specsFor('> a\n> b\n\nend', 1)
    expect(kinds(specs, 'hide')).toEqual([{ kind: 'hide', from: 4, to: 6 }])
  })

  it('marks nested quote lines once', () => {
    const specs = specsFor('> a\n> > b\n\nend')
    expect(lineClasses(specs).filter((c) => c === 'cm-live-quote')).toHaveLength(2)
    expect(lineClasses(specs).filter((c) => c === 'cm-live-quote-nest')).toHaveLength(1)
  })
})

describe('code blocks', () => {
  const texts = (doc: string, specs: BlockSpec[]): string[] =>
    specs
      .map((s) => s as { from: number; to: number })
      .sort((a, b) => a.from - b.from)
      .map((s) => doc.slice(s.from, s.to))

  it('styles every line and hides the fences outside the block', () => {
    const doc = '```ts\nlet a\n```\n\nend'
    const specs = specsFor(doc)
    expect(lineClasses(specs)).toEqual([
      'cm-live-codeblock cm-live-codeblock-first',
      'cm-live-codeblock',
      'cm-live-codeblock cm-live-codeblock-last',
    ])
    expect(texts(doc, kinds(specs, 'hide'))).toEqual(['```', 'ts', '```'])
    expect(kinds(specs, 'mark')).toEqual([])
  })

  it('dims the fences while any line of the block is edited', () => {
    const doc = '```ts\nlet a\n```\n\nend'
    const specs = specsFor(doc, 8)
    expect(texts(doc, kinds(specs, 'mark'))).toEqual(['```', 'ts', '```'])
    expect(kinds(specs, 'hide')).toEqual([])
  })

  it('hides the only fence of an unclosed block', () => {
    const doc = 'end\n```\ncode'
    expect(texts(doc, kinds(specsFor(doc, 0), 'hide'))).toEqual(['```'])
  })

  it('ignores block syntax inside code', () => {
    const doc = '```\n> q\n- [ ] t\n![a](/img/x)\n```\n\nend'
    const specs = specsFor(doc)
    expect(texts(doc, kinds(specs, 'hide'))).toEqual(['```', '```'])
    expect(kinds(specs, 'bullet')).toEqual([])
    expect(kinds(specs, 'checkbox')).toEqual([])
    expect(kinds(specs, 'image')).toEqual([])
  })
})

describe('quotes and code', () => {
  it('hides the marks inside a quoted code block like the other quote lines', () => {
    const doc = '> ```\n> code\n> ```\n\nend'
    const hides = kinds(specsFor(doc), 'hide')
      .map((s) => s as { from: number; to: number })
      .filter((s) => doc[s.from] === '>')
      .sort((x, y) => x.from - y.from)
    expect(hides).toEqual([
      { kind: 'hide', from: 0, to: 2 },
      { kind: 'hide', from: 6, to: 8 },
      { kind: 'hide', from: 13, to: 15 },
    ])
  })

  it('keeps the mark of the cursor line inside a quoted code block', () => {
    const doc = '> ```\n> code\n> ```\n\nend'
    const hides = kinds(specsFor(doc, 8), 'hide')
      .map((s) => (s as { from: number }).from)
      .filter((from) => doc[from] === '>')
    expect(hides.sort((x, y) => x - y)).toEqual([0, 13])
  })

  it('does not style a line after a trailing newline', () => {
    const cases: [string, number][] = [
      ['> a\n> b\n', 2],
      ['- a\n- b\n', 0],
      ['```\nx\n```\n', 3],
      ['    code\n', 1],
    ]
    for (const [doc, styled] of cases) {
      const lines = specsFor(doc, 0).filter((s) => s.kind === 'line')
      expect(lines.every((s) => s.from < doc.length)).toBe(true)
      expect(lines.map((s) => s.from)).toHaveLength(styled)
    }
  })
})

describe('ranges', () => {
  const doc = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? `> quote ${i}` : i % 3 === 1 ? `- [ ] task ${i}` : `![a](/img/${i})`)).join('\n\n')
  const state = stateFor(doc, 0)

  it('returns only specs inside a small range of a large document', () => {
    const from = state.doc.line(401).from
    const to = state.doc.line(409).to
    const specs = collectBlockSpecs(state, [{ from, to }])
    expect(specs.length).toBeGreaterThan(0)
    expect(specs.length).toBeLessThan(40)
    for (const spec of specs) {
      expect(spec.from).toBeGreaterThanOrEqual(from)
      expect(spec.from).toBeLessThanOrEqual(to)
    }
  })

  it('clips a node that starts before the range', () => {
    const quote = Array.from({ length: 500 }, (_, i) => `> q${i}`).join('\n')
    const s = stateFor(quote, 0)
    const from = s.doc.line(250).from
    const specs = collectBlockSpecs(s, [{ from, to: s.doc.line(252).to }])
    expect(lineClasses(specs)).toHaveLength(3)
  })

  it('drops repeats from duplicate or overlapping ranges', () => {
    const range = { from: state.doc.line(21).from, to: state.doc.line(41).to }
    const once = collectBlockSpecs(state, [range])
    expect(collectBlockSpecs(state, [range, range, range])).toEqual(once)
  })
})

describe('robustness', () => {
  const tricky = [
    '![a\nb](/img/x)',
    '> ```\n> code\n> ```',
    '- [ ]\n- [x]',
    '- [ ] > ![a](/img/x)',
    '> - [ ] a\n>   ---',
    '```\nunclosed',
    '    indented code\n\n---',
    '![a](</img/x>)',
    'a\r\n- [ ] b\r\n---\r\n',
  ]

  it.each(tricky)('builds without throwing or overlapping replaces for %j', (doc) => {
    for (const cursor of [0, Math.floor(doc.length / 2), doc.length]) {
      const state = EditorState.create({
        doc,
        selection: { anchor: cursor },
        extensions: [new LanguageSupport(markdownLanguage), EditorState.lineSeparator.of('\n')],
      })
      expect(() => {
        buildBlockDecorations(state, [{ from: 0, to: doc.length }])
        buildPreviewDecorations(state)
      }).not.toThrow()
      const replaced = collectBlockSpecs(state, [{ from: 0, to: doc.length }])
        .filter((s) => s.kind === 'hide' || s.kind === 'image' || s.kind === 'checkbox' || s.kind === 'rule')
        .map((s) => s as { from: number; to: number })
        .sort((a, b) => a.from - b.from)
      for (const r of replaced) expect(state.doc.lineAt(r.from).number).toBe(state.doc.lineAt(r.to).number)
      for (let i = 1; i < replaced.length; i++) expect(replaced[i]!.from).toBeGreaterThanOrEqual(replaced[i - 1]!.to)
    }
  })
})
