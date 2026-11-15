import { describe, expect, it } from 'vitest'
import { blockSignature, collapseBlockGaps, topLevelBlocks } from '../../scripts/notion-markdown'

const TABLE = '| x | y |\n| --- | --- |\n| 1 | 2 |'
const FENCE = '```\ncode\n```'

/** Collapses `md`, checking that the top-level parse does not change. */
function collapse(md: string): string {
  const out = collapseBlockGaps(md)
  expect(blockSignature(out)).toEqual(blockSignature(md))
  return out
}

describe('topLevelBlocks', () => {
  it('reports node names and 0-based line spans', () => {
    expect(topLevelBlocks(`# h\n\nline one\nline two\n\n${TABLE}`)).toEqual([
      { name: 'ATXHeading1', firstLine: 0, lastLine: 0 },
      { name: 'Paragraph', firstLine: 2, lastLine: 3 },
      { name: 'Table', firstLine: 5, lastLine: 7 },
    ])
  })

  it('does not let a node own the line after its trailing line break', () => {
    expect(topLevelBlocks('# h\ntext')).toEqual([
      { name: 'ATXHeading1', firstLine: 0, lastLine: 0 },
      { name: 'Paragraph', firstLine: 1, lastLine: 1 },
    ])
  })
})

describe('blockSignature', () => {
  it('merges runs of adjacent paragraphs', () => {
    expect(blockSignature('a\n\nb\n\n---')).toEqual(['Paragraph', 'HorizontalRule'])
    expect(blockSignature('a\n\nb')).toEqual(['Paragraph'])
  })
})

describe('collapseBlockGaps', () => {
  describe('joins the blocks', () => {
    it.each([
      ['heading -> paragraph', '# a\n\nb'],
      ['card -> card', '@[card](https://a.example)\n\n@[card](https://b.example)'],
      ['paragraph -> table', `text\n\n${TABLE}`],
      ['paragraph -> fenced code', `text\n\n${FENCE}`],
      ['paragraph -> bullet list', 'text\n\n- a\n- b'],
      ['fence -> paragraph', `${FENCE}\n\ntext`],
      ['table -> heading', `${TABLE}\n\n# h`],
    ])('%s', (_name, md) => {
      const out = collapse(md)
      expect(out).toBe(md.replace('\n\n', '\n'))
    })
  })

  describe('keeps the blank line', () => {
    it.each([
      ['table -> paragraph', `${TABLE}\n\ntext`],
      ['bullet list -> paragraph', '- a\n- b\n\ntext'],
      ['blockquote -> paragraph', '> q\n\ntext'],
      ['paragraph -> ---', 'text\n\n---'],
      ['paragraph -> 2. x', 'text\n\n2. x'],
      ['paragraph -> indented line', 'text\n\n    indented'],
    ])('%s', (_name, md) => {
      expect(collapse(md)).toBe(md)
    })
  })

  describe('leaves alone', () => {
    it('two blank lines', () => {
      expect(collapse('# a\n\n\nb')).toBe('# a\n\n\nb')
    })

    it('blank lines inside a fenced code block', () => {
      const md = '```\na\n\nb\n```'
      expect(collapse(md)).toBe(md)
    })

    it('a blank line inside a loose list', () => {
      const md = '- a\n\n- b'
      expect(collapse(md)).toBe(md)
    })
  })

  it('tests the second gap of a chain against the merged paragraph (setext heading)', () => {
    expect(collapse('a\n\nb\n\n---')).toBe('a\nb\n\n---')
  })

  it('tests a table against the merged tail, not only the previous block', () => {
    // A table cannot interrupt a paragraph whose first line holds a pipe.
    expect(topLevelBlocks('a | b\nc\n| x | y |\n| --- | --- |').map((b) => b.name)).toEqual(['Paragraph'])
    const md = `a | b\n\nc\n\n${TABLE}`
    expect(collapse(md)).toBe(`a | b\nc\n\n${TABLE}`)
  })

  it('collapses a long mixed chain', () => {
    const md = `# h\n\nintro\n\n@[card](https://a.example)\n\n@[card](https://b.example)\n\n${TABLE}\n\ntail`
    expect(collapse(md)).toBe(`# h\nintro\n@[card](https://a.example)\n@[card](https://b.example)\n${TABLE}\n\ntail`)
  })

  it('returns an empty string and a single block unchanged', () => {
    expect(collapse('')).toBe('')
    expect(collapse('# only')).toBe('# only')
    expect(collapse('a\nb')).toBe('a\nb')
  })
})
