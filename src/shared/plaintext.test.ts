import { describe, expect, it } from 'vitest'
import { markdownToPlain } from './plaintext'

describe('markdownToPlain', () => {
  it('keeps heading text', () => {
    expect(markdownToPlain('# Heading')).toBe('Heading')
  })

  it('strips bold, emphasis and strikethrough markers but keeps the text', () => {
    expect(markdownToPlain('**bold** and _em_ and ~~del~~')).toBe('bold and em and del')
  })

  it('keeps inline code content', () => {
    expect(markdownToPlain('inline `code` here')).toBe('inline code here')
  })

  it('keeps link text and drops the URL', () => {
    expect(markdownToPlain('[a link](https://example.com) text')).toBe('a link text')
  })

  it('drops images entirely', () => {
    expect(markdownToPlain('before ![alt](https://example.com/x.png) after')).toBe('before  after')
  })

  it('keeps fenced code content', () => {
    expect(markdownToPlain('```js\nconst x = 1;\nconsole.log(x)\n```')).toBe('const x = 1;\nconsole.log(x)')
  })

  it('turns nested lists into one item per line', () => {
    expect(markdownToPlain('- a\n  - b\n  - c\n- d')).toBe('a\nb\nc\nd')
  })

  it('keeps a loose list item with multiple paragraphs on separate lines', () => {
    expect(markdownToPlain('- para one\n\n  para two\n- item 2')).toBe('para one\npara two\nitem 2')
  })

  it('keeps blockquote text', () => {
    expect(markdownToPlain('> quoted text\n> more')).toBe('quoted text\nmore')
  })

  it('joins table cells with spaces, one row per line', () => {
    expect(markdownToPlain('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('a b\n1 2')
  })

  it('removes inline HTML tags but keeps their content', () => {
    expect(markdownToPlain('foo <b>bar</b> baz')).toBe('foo bar baz')
  })

  it('removes tags from an HTML block', () => {
    expect(markdownToPlain('<div>\nblock content\n</div>')).toBe('block content')
  })

  it('collapses runs of blank lines to a single blank line', () => {
    expect(markdownToPlain('```\nline1\n\n\nline2\n```\n\nnext para')).toBe('line1\n\nline2\nnext para')
  })

  it('shows the URL for a card line', () => {
    expect(markdownToPlain('@[card](https://example.com)')).toBe('https://example.com')
  })

  it('keeps surrounding paragraphs around a card', () => {
    expect(markdownToPlain('before\n\n@[card](https://x.example)\n\nafter')).toBe('before\nhttps://x.example\nafter')
  })

  it('puts a card inside a paragraph on its own line', () => {
    expect(markdownToPlain('a\n@[card](https://x.example)\nb')).toBe('a\nhttps://x.example\nb')
  })

  it('keeps a mid-line card marker as before', () => {
    expect(markdownToPlain('see @[card](https://x.example) here')).toBe('see @card here')
  })

  it('keeps a card inside a fenced code block verbatim', () => {
    expect(markdownToPlain('```\n@[card](https://x.example)\n```')).toBe('@[card](https://x.example)')
  })

  it('passes Japanese text through unchanged', () => {
    expect(markdownToPlain('日本語のテキストです')).toBe('日本語のテキストです')
  })
})
