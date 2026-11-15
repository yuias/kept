import { describe, expect, it } from 'vitest'
import { blockSignature, collapseBlockGaps, countRowPipes, joinBrokenTableRows, topLevelBlocks } from '../../scripts/notion-markdown'

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

describe('countRowPipes', () => {
  it('counts the pipes of a row', () => {
    expect(countRowPipes('| a | b |')).toBe(3)
  })

  it('counts pipes inside code spans, as the table parser does', () => {
    expect(countRowPipes('| `a|b` |')).toBe(3)
  })

  it('does not count an escaped pipe, but counts one after an escaped backslash', () => {
    expect(countRowPipes('| a \\| b |')).toBe(2)
    expect(countRowPipes('| a \\\\| b |')).toBe(3)
  })
})

describe('joinBrokenTableRows', () => {
  const DELIMITER = '| --- | --- |'

  it('joins a data row broken over two lines', () => {
    expect(joinBrokenTableRows(`| h1 | h2 |\n${DELIMITER}\n| a | b\nc |\n| d | e |`)).toBe(`| h1 | h2 |\n${DELIMITER}\n| a | b<br>c |\n| d | e |`)
  })

  it('joins a data row broken over three lines', () => {
    expect(joinBrokenTableRows(`| h1 | h2 |\n${DELIMITER}\n| a | b\nc\nd |\n| e | f |`)).toBe(`| h1 | h2 |\n${DELIMITER}\n| a | b<br>c<br>d |\n| e | f |`)
  })

  it('joins a continuation that starts in the first cell', () => {
    expect(joinBrokenTableRows(`| h1 | h2 |\n${DELIMITER}\n| a\nb | c |`)).toBe(`| h1 | h2 |\n${DELIMITER}\n| a<br>b | c |`)
  })

  it('joins a header broken before the delimiter, which makes it a table', () => {
    const md = `| h1 | h2\nh3 |\n${DELIMITER}\n| a | b |`
    expect(topLevelBlocks(md).map((block) => block.name)).not.toContain('Table')
    const out = joinBrokenTableRows(md)
    expect(out).toBe(`| h1 | h2<br>h3 |\n${DELIMITER}\n| a | b |`)
    expect(topLevelBlocks(out)).toEqual([{ name: 'Table', firstLine: 0, lastLine: 2 }])
  })

  it('does not count an escaped pipe as a cell boundary when joining', () => {
    expect(joinBrokenTableRows(`| h1 | h2 |\n${DELIMITER}\n| a \\| b | c\nd |`)).toBe(`| h1 | h2 |\n${DELIMITER}\n| a \\| b | c<br>d |`)
  })

  it('counts a pipe after an escaped backslash and a pipe inside backticks', () => {
    // Both rows are complete with 3 pipes, so nothing is joined.
    const md = `| h1 | h2 |\n${DELIMITER}\n| a \\\\| b |\n| \`x|y\` |`
    expect(joinBrokenTableRows(md)).toBe(md)
  })

  it('leaves a blank line inside a cell as it is', () => {
    const md = `| h1 | h2 |\n${DELIMITER}\n| a | b\n\nc |\n| d | e |`
    expect(joinBrokenTableRows(md)).toBe(md)
  })

  it('stops at an overshooting join and leaves that row and the rest unchanged', () => {
    const md = `| h1 | h2 |\n${DELIMITER}\n| a | b\nc |\n| d | e | f |\n| g | h |`
    expect(joinBrokenTableRows(md)).toBe(`| h1 | h2 |\n${DELIMITER}\n| a | b<br>c |\n| d | e | f |\n| g | h |`)
    const overshoot = `| h1 | h2 |\n${DELIMITER}\n| a | b\n| c | d |`
    expect(joinBrokenTableRows(overshoot)).toBe(overshoot)
  })

  it('leaves a table that looks broken inside a fenced code block', () => {
    const md = `\`\`\`\n| h1 | h2 |\n${DELIMITER}\n| a | b\nc |\n\`\`\``
    expect(joinBrokenTableRows(md)).toBe(md)
  })

  it('leaves a line directly under a repaired table that is not a row', () => {
    expect(joinBrokenTableRows(`| h1 | h2 |\n${DELIMITER}\n| a | b\nc |\n- item`)).toBe(`| h1 | h2 |\n${DELIMITER}\n| a | b<br>c |\n- item`)
  })

  it('leaves a block without a delimiter row alone', () => {
    const md = '| a | b\nc |\n| d | e |'
    expect(joinBrokenTableRows(md)).toBe(md)
  })

  it('leaves a well-formed table unchanged, and its own output unchanged', () => {
    expect(joinBrokenTableRows(TABLE)).toBe(TABLE)
    const once = joinBrokenTableRows(`| h1 | h2 |\n${DELIMITER}\n| a | b\nc |`)
    expect(joinBrokenTableRows(once)).toBe(once)
  })

  it('keeps the text around the table', () => {
    expect(joinBrokenTableRows(`before\n\n| h1 | h2 |\n${DELIMITER}\n| a | b\nc |\n\nafter`)).toBe(`before\n\n| h1 | h2 |\n${DELIMITER}\n| a | b<br>c |\n\nafter`)
  })
})
