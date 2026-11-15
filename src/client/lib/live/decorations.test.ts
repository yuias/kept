import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport, syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { activeLineNumbers, touchesSelection } from './active-lines'
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

function stateFor(doc: string, cursor: number, readOnly = false): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [new LanguageSupport(markdownLanguage), EditorState.readOnly.of(readOnly)],
  })
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

describe('touchesSelection', () => {
  const doc = 'abcdef'

  it('is true at both edges and inside', () => {
    for (const cursor of [2, 3, 4]) expect(touchesSelection(stateFor(doc, cursor), 2, 4)).toBe(true)
  })

  it('is false one position outside', () => {
    expect(touchesSelection(stateFor(doc, 1), 2, 4)).toBe(false)
    expect(touchesSelection(stateFor(doc, 5), 2, 4)).toBe(false)
  })

  it('is true for a selection overlapping one character', () => {
    const state = EditorState.create({ doc, selection: { anchor: 0, head: 3 } })
    expect(touchesSelection(state, 2, 4)).toBe(true)
  })

  it('is false in a read-only editor', () => {
    expect(touchesSelection(stateFor(doc, 3, true), 2, 4)).toBe(false)
  })
})

describe('syntax tree shapes', () => {
  const names = (doc: string, parent: string): string[] => {
    const state = stateFor(doc, 0)
    const out: string[] = []
    syntaxTree(state).iterate({
      enter: (ref) => {
        if (ref.name === parent) for (let c = ref.node.firstChild; c; c = c.nextSibling) out.push(`${c.name} ${c.from}-${c.to}`)
      },
    })
    return out
  }

  it('nests strong inside emphasis for triple markers', () => {
    expect(names('***foo***', 'Emphasis')).toEqual([
      'EmphasisMark 0-1',
      'StrongEmphasis 1-8',
      'EmphasisMark 8-9',
    ])
    expect(names('***foo***', 'StrongEmphasis')).toEqual(['EmphasisMark 1-3', 'EmphasisMark 6-8'])
  })

  it('orders link marks as open bracket, close bracket, open paren, close paren', () => {
    const doc = '[a](u)'
    const state = stateFor(doc, 0)
    const marks: string[] = []
    syntaxTree(state).iterate({
      enter: (ref) => {
        if (ref.name === 'LinkMark') marks.push(doc.slice(ref.from, ref.to))
      },
    })
    expect(marks).toEqual(['[', ']', '(', ')'])
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

  it('adds heading gaps only where no blank line separates the heading', () => {
    const gaps = (doc: string) => classes(specsFor(doc, 0)).filter((c) => c.startsWith('cm-live-h-'))
    expect(gaps('# a\n- x\n## b\n- y')).toEqual(['cm-live-h-below', 'cm-live-h-above', 'cm-live-h-below'])
    expect(gaps('# a\n\n- x\n\n## b\n\n- y')).toEqual([])
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

  it('shows the touched element and hides the others on the cursor line', () => {
    const doc = '**b** and *i*'
    expect(hidden(specsFor(doc, 3), doc)).toEqual(['*', '*'])
  })

  it('reveals every element a multi-line selection overlaps', () => {
    const doc = '**a**\n**b**\n**c**'
    // Lines 1 and 2 are selected, so only the third line's markers hide.
    expect(hidden(specsFor(doc, [0, 7]), doc)).toEqual(['**', '**'])
  })
})

describe('element-level reveal', () => {
  const marked = (specs: LiveSpec[]): number => specs.filter((s) => s.kind === 'mark' && s.className === 'cm-live-marker').length

  it('hides and shows markers by the element the cursor touches', () => {
    const doc = 'foo **bar** baz'
    expect(hidden(specsFor(doc, 0), doc)).toEqual(['**', '**'])
    for (const cursor of [4, 6, 11]) {
      const specs = specsFor(doc, cursor)
      expect(hidden(specs, doc)).toEqual([])
      expect(marked(specs)).toBe(2)
    }
    expect(hidden(specsFor(doc, 12), doc)).toEqual(['**', '**'])
    expect(hidden(specsFor(doc, [0, 5]), doc)).toEqual([])
  })

  const sameLine: [string, string, string, number][] = [
    ['emphasis', '*i* tail', '*', 0],
    ['strikethrough', '~~s~~ tail', '~~', 0],
    ['code', '`c` tail', '`', 0],
    ['link', '[t](https://e.example) tail', '[', 0],
    ['autolink', '<https://e.example> tail', '<', 0],
  ]
  it.each(sameLine)('hides an untouched %s while a touched one shows', (_name, element, firstMarker) => {
    const doc = `${element} **b**`
    const bold = doc.indexOf('**b**')
    // Cursor inside the bold: the first element hides, the bold shows.
    const away = hidden(specsFor(doc, bold + 2), doc)
    expect(away).toContain(firstMarker)
    expect(away).not.toContain('**')
    // Cursor at the element's edge: it shows, the bold hides.
    const edge = hidden(specsFor(doc, 0), doc)
    expect(edge).not.toContain(firstMarker)
    expect(edge).toEqual(['**', '**'])
  })

  it('leaves unclosed emphasis as literal text', () => {
    const doc = '***foo'
    for (let cursor = 0; cursor <= doc.length; cursor++) {
      const specs = specsFor(doc, cursor)
      expect(specs.some((s) => s.kind === 'hide')).toBe(false)
      expect(classes(specs)).not.toContain('cm-live-strong')
      expect(classes(specs)).not.toContain('cm-live-em')
    }
  })

  it('shows and hides nested markers as a unit', () => {
    const doc = '***foo***\n\nx'
    expect(hidden(specsFor(doc, doc.length), doc).join('')).toBe('******')
    for (const cursor of [0, 4, 9]) expect(hidden(specsFor(doc, cursor), doc)).toEqual([])
  })

  it('reveals a link by its edges, not by its line', () => {
    const doc = '[t](https://e.example) tail'
    expect(hidden(specsFor(doc, 2), doc)).toEqual([])
    expect(hidden(specsFor(doc, doc.length), doc)).toEqual(['[', '](https://e.example)'])
  })

  it('keeps the heading marker line-based while inline markers are element-based', () => {
    const doc = '# a **b**'
    const specs = specsFor(doc, 0)
    expect(hidden(specs, doc)).toEqual(['**', '**'])
    expect(specs).toContainEqual({ kind: 'mark', from: 0, to: 2, className: 'cm-live-marker' })
  })

  it('shows a whole card line with the caret before it', () => {
    const doc = '@[card](https://a.example)\n\ntail'
    expect(hidden(specsFor(doc, 0), doc)).toEqual([])
  })

  it('reveals nothing in a read-only editor', () => {
    const doc = '**b**'
    const specs = collectSpecs(stateFor(doc, 2, true), [{ from: 0, to: doc.length }])
    expect(hidden(specs, doc)).toEqual(['**', '**'])
  })

  it('reveals only the elements each cursor touches', () => {
    const doc = '**a** **b** **c**'
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(14)]),
      extensions: [new LanguageSupport(markdownLanguage), EditorState.allowMultipleSelections.of(true)],
    })
    const specs = collectSpecs(state, [{ from: 0, to: doc.length }])
    expect(hidden(specs, doc)).toEqual(['**', '**'])
    expect(specs.filter((s) => s.kind === 'hide').map((s) => s.from)).toEqual([6, 9])
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

  const cursorDocs = [
    ...tricky,
    'foo **bar** baz',
    '***foo***',
    '[t](https://e.example) x',
    '# t #\n\n*e* <https://e.example>',
    'a `c` ~~s~~ b',
  ]

  it.each(cursorDocs)('never leaves a cursor on or inside a hidden range of %j', (doc) => {
    for (let cursor = 0; cursor <= doc.length; cursor++) {
      for (const spec of collectSpecs(stateFor(doc, cursor), [{ from: 0, to: doc.length }])) {
        if (spec.kind !== 'hide') continue
        expect(spec.from <= cursor && cursor <= spec.to).toBe(false)
      }
    }
  })

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
