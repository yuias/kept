import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { activeLineNumbers } from './active-lines'
import { buildDecorations, collectSpecs, type LiveSpec } from './decorations'

function specsFor(doc: string, cursor: number | [number, number] = doc.length): LiveSpec[] {
  const [anchor, head] = Array.isArray(cursor) ? cursor : [cursor, cursor]
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [new LanguageSupport(markdownLanguage)],
  })
  return collectSpecs(state, [{ from: 0, to: doc.length }])
}

const hidden = (specs: LiveSpec[], doc: string): string[] =>
  specs.filter((s) => s.kind === 'hide').map((s) => doc.slice(s.from, (s as { to: number }).to))

const classes = (specs: LiveSpec[]): string[] =>
  specs.flatMap((s) => (s.kind === 'line' || s.kind === 'mark' ? [s.className] : []))

describe('activeLineNumbers', () => {
  it('covers every line a selection touches', () => {
    const state = EditorState.create({ doc: 'a\nb\nc\nd', selection: { anchor: 2, head: 5 } })
    expect([...activeLineNumbers(state)]).toEqual([2, 3])
  })

  it('is empty in a read-only editor', () => {
    const state = EditorState.create({ doc: 'a\nb', extensions: EditorState.readOnly.of(true) })
    expect([...activeLineNumbers(state)]).toEqual([])
  })
})

describe('headings', () => {
  it('adds a line class per level and hides the marker off the cursor line', () => {
    const doc = '### title\n\nbody'
    const specs = specsFor(doc, doc.length)
    expect(specs).toContainEqual({ kind: 'line', from: 0, className: 'cm-live-h3' })
    expect(hidden(specs, doc)).toEqual(['### '])
  })

  it('keeps the marker visible, but dimmed, on the cursor line', () => {
    const doc = '## title'
    const specs = specsFor(doc, 4)
    expect(hidden(specs, doc)).toEqual([])
    expect(classes(specs)).toEqual(['cm-live-h2', 'cm-live-marker'])
  })

  it('does not treat a marker without a space as a heading', () => {
    expect(classes(specsFor('###title\n\nx'))).toEqual([])
  })

  it('never hides the marker of an otherwise empty heading', () => {
    const doc = '###\n\nx'
    expect(hidden(specsFor(doc), doc)).toEqual([])
  })

  it('hides a closing sequence with the space before it', () => {
    const doc = '# title #\n\nx'
    expect(hidden(specsFor(doc), doc)).toEqual(['# ', ' #'])
  })

  it('styles setext heading text and leaves the underline visible', () => {
    const doc = 'Title\n=====\n\nx'
    const specs = specsFor(doc)
    expect(specs.filter((s) => s.kind === 'line')).toEqual([{ kind: 'line', from: 0, className: 'cm-live-h1' }])
    expect(hidden(specs, doc)).toEqual([])
  })
})

describe('inline styles', () => {
  it('styles and hides bold, italic, strike and code markers off the cursor line', () => {
    const doc = '**b** *i* ~~s~~ `c`\n\ncursor'
    const specs = specsFor(doc)
    expect(classes(specs).sort()).toEqual(['cm-live-code', 'cm-live-em', 'cm-live-strike', 'cm-live-strong'])
    expect(hidden(specs, doc)).toEqual(['**', '**', '*', '*', '~~', '~~', '`', '`'])
  })

  it('shows every marker on the cursor line', () => {
    const doc = '**b** and *i*'
    expect(hidden(specsFor(doc, 3), doc)).toEqual([])
  })

  it('treats any line inside a multi-line selection as active', () => {
    const doc = '**a**\n**b**\n**c**'
    // Lines 1 and 2 are selected, so only the third line's markers hide.
    expect(hidden(specsFor(doc, [0, 7]), doc)).toEqual(['**', '**'])
  })
})

describe('links', () => {
  it('hides the brackets and target of an inline link', () => {
    const doc = '[text](https://example.com "t")\n\nx'
    const specs = specsFor(doc)
    expect(hidden(specs, doc)).toEqual(['[', '](https://example.com "t")'])
    expect(specs).toContainEqual({ kind: 'link', from: 1, to: 5, href: 'https://example.com' })
  })

  it('gives a link spec with an href for allowed targets', () => {
    const doc = '[t](https://a.example)\n\nx'
    expect(specsFor(doc)).toContainEqual({ kind: 'link', from: 1, to: 2, href: 'https://a.example' })
  })

  it('leaves the href null for a disallowed target', () => {
    const doc = '[t](javascript:x)\n\nx'
    expect(specsFor(doc)).toContainEqual({ kind: 'link', from: 1, to: 2, href: null })
  })

  it('derives hrefs for bare URLs and autolinks', () => {
    const bare = 'see https://a.example now\n\nx'
    expect(specsFor(bare)).toContainEqual({ kind: 'link', from: 4, to: 21, href: 'https://a.example' })
    const auto = '<https://a.example>\n\nx'
    expect(specsFor(auto)).toContainEqual({ kind: 'link', from: 0, to: 19, href: 'https://a.example' })
  })

  it('emits nothing for a card line off the caret line', () => {
    const doc = '@[card](https://a.example)\n\ntail'
    expect(specsFor(doc, doc.length)).toEqual([])
  })

  it('still decorates a card line that holds the caret', () => {
    const doc = '@[card](https://a.example)\n\ntail'
    const specs = specsFor(doc, 3)
    expect(specs).toContainEqual({ kind: 'link', from: 2, to: 6, href: 'https://a.example' })
    expect(classes(specs)).toContain('cm-live-marker')
  })

  it('keeps decorating a mid-line card-like link', () => {
    const doc = 'see @[card](https://a.example)\n\ntail'
    expect(specsFor(doc, doc.length)).toContainEqual({ kind: 'link', from: 6, to: 10, href: 'https://a.example' })
  })

  it('leaves reference-style brackets alone', () => {
    const doc = '[text][ref]\n\nx'
    expect(hidden(specsFor(doc), doc)).toEqual([])
  })

  it('does not decorate inside images or fenced code', () => {
    const doc = '![alt](/img/1)\n\n```\n**not bold**\n```\n\nx'
    const specs = specsFor(doc)
    expect(hidden(specs, doc)).toEqual([])
    expect(classes(specs)).toEqual([])
  })
})

describe('robustness', () => {
  const tricky = [
    '[text]\n(https://example.com)\n\nx',
    '[text](\nhttps://example.com)',
    '**bold\nacross lines** and *em\nphasis*',
    '### x ###',
    '### heading at eof',
    '###',
    '`code\nspan` ~~a\nb~~',
    '<https://example.com> https://bare.example.com',
    '[a](b "title\nover lines")',
  ]

  it.each(tricky)('builds decorations without throwing for %j', (doc) => {
    for (const cursor of [0, doc.length]) {
      const state = EditorState.create({
        doc,
        selection: { anchor: cursor },
        extensions: [new LanguageSupport(markdownLanguage)],
      })
      expect(() => buildDecorations(state, [{ from: 0, to: doc.length }])).not.toThrow()
      for (const spec of collectSpecs(state, [{ from: 0, to: doc.length }])) {
        if (spec.kind !== 'hide') continue
        expect(state.doc.lineAt(spec.from).number).toBe(state.doc.lineAt(spec.to).number)
      }
    }
  })
})

describe('line endings', () => {
  it('round-trips CR and CRLF documents byte for byte', () => {
    const doc = 'a\r\nb\rc\n'
    const state = EditorState.create({ doc, extensions: [EditorState.lineSeparator.of('\n')] })
    expect(state.doc.toString()).toBe(doc)
    const edited = state.update({ changes: { from: 0, insert: 'x' } }).state
    expect(edited.doc.toString()).toBe(`x${doc}`)
  })
})

describe('tables', () => {
  const doc = '| **a** | [x](https://e.example) |\n|---|---|\n\nend'
  const tableEnd = doc.indexOf('\n\nend')

  it('adds no inline spec inside a rendered table', () => {
    const specs = specsFor(doc, doc.length)
    expect(specs.filter((s) => s.from < tableEnd)).toEqual([])
  })

  it('decorates the source while the caret is on a table line', () => {
    const specs = specsFor(doc, 2)
    expect(classes(specs)).toContain('cm-live-strong')
    expect(specs.some((s) => s.kind === 'link')).toBe(true)
  })
})
