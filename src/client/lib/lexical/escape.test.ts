import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  $isTextNode,
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  IS_STRIKETHROUGH,
} from 'lexical'
import { describe, expect, it } from 'vitest'
import { escapeLineStart, escapePlainText } from './escape'
import { $exportMarkdown, $importMarkdown, createMarkdownEditor, roundTrip } from './markdown'

const esc = (text: string, before = '', after = ''): string => escapePlainText(text, before, after)

describe('escapePlainText', () => {
  it('doubles a backslash before ASCII punctuation, also across the node end', () => {
    expect(esc('a\\*b')).toBe('a\\\\*b')
    expect(esc('dir\\sub\\x')).toBe('dir\\sub\\x')
    expect(esc('end\\', '', '#')).toBe('end\\\\')
    expect(esc('end\\', '', 'a')).toBe('end\\')
  })

  it('escapes paired emphasis runs and leaves unpaired ones', () => {
    expect(esc('*foo*')).toBe('\\*foo\\*')
    expect(esc('**foo**')).toBe('\\*\\*foo\\*\\*')
    expect(esc('_foo_')).toBe('\\_foo\\_')
    expect(esc('~~x~~')).toBe('\\~\\~x\\~\\~')
    expect(esc('foo_bar')).toBe('foo_bar')
    expect(esc('snake_case_name')).toBe('snake_case_name')
    expect(esc('2 * 3 * 4')).toBe('2 * 3 * 4')
    expect(esc('10~20')).toBe('10~20')
    expect(esc('https://a.example/x_y_z')).toBe('https://a.example/x_y_z')
    expect(esc('a*b*c')).toBe('a\\*b\\*c')
  })

  it('escapes both runs when a longer run is closed by a shorter one', () => {
    expect(esc('**a*')).toBe('\\*\\*a\\*')
  })

  it('does not pair a run with itself', () => {
    expect(esc('a**b')).toBe('a**b')
  })

  it('reads flanking across punctuation, CJK punctuation and emoji', () => {
    expect(esc('「*太字*」')).toBe('「\\*太字\\*」')
    expect(esc('🎉*a*')).toBe('🎉\\*a\\*')
  })

  it('uses the neighbouring characters at the node edges', () => {
    expect(esc('*a', ' ', '')).toBe('*a')
    expect(esc('a*', '', ' ')).toBe('a*')
    expect(esc('*a', '', '')).toBe('*a')
    expect(esc('a*', '', 'b')).toBe('a*')
    expect(esc('*a*', '', '')).toBe('\\*a\\*')
  })

  it('always escapes a run of the same character that touches a delimiter', () => {
    const star = { delimiter: '*' }
    expect(escapePlainText('_id', star, '')).toBe('_id')
    expect(escapePlainText('*a', star, '')).toBe('\\*a')
    expect(escapePlainText('a*', '', star)).toBe('a\\*')
    expect(escapePlainText('~x', star, '')).toBe('~x')
    expect(escapePlainText('~x', { delimiter: '~' }, '')).toBe('\\~x')
    expect(escapePlainText('`(', { delimiter: '`' }, '')).toBe('\\`(')
    expect(escapePlainText('**', { delimiter: '`' }, '')).toBe('**')
    expect(escapePlainText('*', star, star)).toBe('\\*')
    expect(escapePlainText('a\\', '', star)).toBe('a\\\\')
    expect(escapePlainText('a_b', star, star)).toBe('a_b')
  })

  it('treats a delimiter as punctuation when pairing', () => {
    expect(escapePlainText('_a_', { delimiter: '*' }, '')).toBe('\\_a\\_')
    expect(escapePlainText('_a_', '', { delimiter: ')' })).toBe('\\_a\\_')
  })

  it('escapes every backtick when two runs have the same length', () => {
    expect(esc('`x`')).toBe('\\`x\\`')
    expect(esc('`a` and ``b``')).toBe('\\`a\\` and \\`\\`b\\`\\`')
    expect(esc('one ` tick')).toBe('one ` tick')
  })

  it('escapes `[` only when `](` follows', () => {
    expect(esc('[a](https://e.example)')).toBe('\\[a](https://e.example)')
    expect(esc('@[card](https://e.example)')).toBe('@\\[card](https://e.example)')
    expect(esc('![a](/img/x)')).toBe('!\\[a](/img/x)')
    expect(esc('[a] and (b)')).toBe('[a] and (b)')
  })

  it('leaves an empty label alone while images are plain text', () => {
    expect(esc('![](/img/x)')).toBe('![](/img/x)')
    expect(esc('[](x)')).toBe('[](x)')
    expect(esc('![a](/img/x)')).toBe('!\\[a](/img/x)')
  })

  it('escapes an empty label only for `![` once images are read', () => {
    expect(escapePlainText('![](/img/x)', '', '', true)).toBe('!\\[](/img/x)')
    expect(escapePlainText('[](x)', '', '', true)).toBe('[](x)')
    expect(escapePlainText('[](x)', '!', '', true)).toBe('\\[](x)')
  })

  it('escapes `&` only before a complete character reference', () => {
    expect(esc('&#32;')).toBe('\\&#32;')
    expect(esc('&#x1F600;')).toBe('\\&#x1F600;')
    expect(esc('a&b &#32')).toBe('a&b &#32')
    expect(esc('x=1&y=2')).toBe('x=1&y=2')
  })

  it('adds one backslash per character when rules overlap', () => {
    expect(esc('\\*a*')).toBe('\\\\\\*a\\*')
  })
})

describe('escapeLineStart', () => {
  it('escapes lines that would start a block', () => {
    expect(escapeLineStart('# x')).toBe('\\# x')
    expect(escapeLineStart('###### x')).toBe('\\###### x')
    expect(escapeLineStart('#')).toBe('\\#')
    expect(escapeLineStart('> x')).toBe('\\> x')
    expect(escapeLineStart('- x')).toBe('\\- x')
    expect(escapeLineStart('+ x')).toBe('\\+ x')
    expect(escapeLineStart('* x')).toBe('\\* x')
    expect(escapeLineStart('1. x')).toBe('1\\. x')
    expect(escapeLineStart('12) x')).toBe('12\\) x')
    expect(escapeLineStart('2.')).toBe('2\\.')
    expect(escapeLineStart('```js')).toBe('\\```js')
    expect(escapeLineStart('```a```')).toBe('\\```a```')
    expect(escapeLineStart('  ```a')).toBe('  \\```a')
    expect(escapeLineStart('-\u3000x')).toBe('\\-\u3000x')
    expect(escapeLineStart('-\tx')).toBe('\\-\tx')
    expect(escapeLineStart('#\tx')).toBe('\\#\tx')
    expect(escapeLineStart('1.\tx')).toBe('1\\.\tx')
    expect(escapeLineStart('  - x')).toBe('  \\- x')
    expect(escapeLineStart('  1. x')).toBe('  1\\. x')
    expect(escapeLineStart('1234567890. x')).toBe('1234567890\\. x')
    expect(escapeLineStart('\\- x')).toBe('\\- x')
    expect(escapeLineStart('~~~')).toBe('\\~~~')
    expect(escapeLineStart('| a | b |')).toBe('\\| a | b |')
    expect(escapeLineStart('[ ] x')).toBe('\\[ ] x')
    expect(escapeLineStart('  [x] x')).toBe('  \\[x] x')
    expect(escapeLineStart('[X] x')).toBe('\\[X] x')
    expect(escapeLineStart('[] x')).toBe('\\[] x')
    expect(escapeLineStart('---')).toBe('\\---')
    expect(escapeLineStart('***')).toBe('\\***')
    expect(escapeLineStart('_ _ _')).toBe('\\_ _ _')
  })

  it('leaves ordinary lines alone', () => {
    for (const line of ['', 'a # b', '#tag', '#1', '-a', '1.5 x', 'a > b', '--', '`code`', '2 * 3', '[ ]', '[x]', '[a] x', '[ x] x', '[link](u) x']) {
      expect(escapeLineStart(line), line).toBe(line)
    }
  })

  it('skips thematic breaks and table rows while the importer reads them as text', () => {
    const off = { thematicBreak: false, tableRow: false }
    expect(escapeLineStart('---', off)).toBe('---')
    expect(escapeLineStart('| a |', off)).toBe('| a |')
    expect(escapeLineStart('# x', off)).toBe('\\# x')
  })
})

type Segment = [text: string, format: number]

// Exports a document of one paragraph per entry and imports the markdown again.
function reload(paragraphs: Segment[][]): { markdown: string; blocks: unknown[] } {
  const writer = createMarkdownEditor()
  writer.update(
    () => {
      const root = $getRoot().clear()
      for (const segments of paragraphs) {
        root.append(
          $createParagraphNode().append(...segments.map(([text, format]) => $createTextNode(text).setFormat(format))),
        )
      }
    },
    { discrete: true },
  )
  const markdown = writer.read(() => $exportMarkdown())
  writer.dispose()

  const reader = createMarkdownEditor()
  reader.update(() => $importMarkdown(markdown), { discrete: true })
  const blocks = reader.read(() =>
    $getRoot()
      .getChildren()
      .map((block) =>
        $isParagraphNode(block)
          ? block.getChildren().map((child) => [$isTextNode(child) ? child.getTextContent() : null, $isTextNode(child) ? child.getFormat() : null])
          : block.getType(),
      ),
  )
  reader.dispose()
  return { markdown, blocks }
}

// A plain text node that holds markup characters must come back as the same
// plain text, not as a format, link, image, card, or another block.
describe('plain text survives export and import', () => {
  const texts = [
    '*foo*',
    '**foo**',
    '_foo_',
    'a_b',
    '~~x~~',
    '`x`',
    '# x',
    '1. x',
    '- x',
    '> x',
    '\\*',
    '[a](https://e.example)',
    '![a](/img/x)',
    '@[card](https://e.example)',
    '&#32;',
    'foo_bar and snake_case_name',
    '2 * 3 * 4',
    '10~20',
    '**a*',
    'a\\b\\\\c',
    '* x',
    '1) x',
    '###### x',
    '```',
    '```js',
    '```a`b',
    '```a```',
    '~~~',
    '==x==',
    '-\u3000x',
    '-\tx',
    '#\tx',
    '1.\tx',
    '  - x',
    '  1. x',
    '1234567890. x',
  ]

  for (const text of texts) {
    it(JSON.stringify(text), () => {
      const { blocks } = reload([[[text, 0]]])
      // A tab is imported as a node of its own, so compare the joined text.
      const [paragraph] = blocks as [string | null, number | null][][]
      expect(blocks).toHaveLength(1)
      expect(paragraph!.map(([t]) => t).join('')).toBe(text)
      expect(paragraph!.every(([, format]) => format === 0)).toBe(true)
    })
  }
})

describe('plain text next to formatted text and code', () => {
  const cases: Record<string, Segment[]> = {
    'a star after italic text': [['a', 0], ['b', IS_ITALIC], ['*', 0]],
    'a backslash before bold text': [['a\\', 0], ['b', IS_BOLD]],
    'an underscore word after code': [['x', IS_CODE], ['_id_', 0]],
    'an underscore word after bold text': [['x', IS_BOLD], ['_a_', 0]],
    'an underscore word before bold text': [['_a_', 0], ['x', IS_BOLD]],
    'a star at the start of bold text': [['*a', IS_BOLD]],
    'a star at the end of italic text': [['a*', IS_ITALIC]],
    'a lone star in bold text': [['*', IS_BOLD]],
    'a tilde at the start of struck text': [['~x', IS_STRIKETHROUGH]],
    'a backtick after code': [['a', IS_CODE], ['`(', 0]],
    'a star around italic text': [['*', 0], ['b', IS_ITALIC], ['*', 0]],
    'backticks around italic text': [['```', 0], ['x', IS_ITALIC], ['```', 0]],
    'code that holds two backticks': [['a``b', IS_CODE]],
    'code that holds two backticks before text': [['a``b', IS_CODE], [' x', 0]],
    'code that holds two spaces': [['  ', IS_CODE]],
  }

  for (const [name, segments] of Object.entries(cases)) {
    it(name, () => {
      expect(reload([segments]).blocks).toEqual([segments])
    })
  }
})

describe('sources that the stock escaping keeps byte-identical', () => {
  const sources = [
    '`x`\\_id\\_',
    '**x**\\_a\\_',
    '[docs](https://e.example)\\_v2\\_',
    '\\_a\\_**x**',
    '**a**\\_\\_b\\_\\_',
    '**\\*a**',
    '*a\\**',
    '**\\***',
    '~~\\~x~~',
    '`a`\\`(',
    '\\**b*\\*',
    '  \\- x',
    '==x==',
    '[](x)',
  ]

  for (const source of sources) {
    it(JSON.stringify(source), () => {
      expect(roundTrip(source)).toBe(source)
    })
  }
})
