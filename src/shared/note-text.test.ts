import { describe, expect, it } from 'vitest'
import { copyableNoteText, rawNoteText } from './note-text'

describe('rawNoteText', () => {
  it('adds the title as a heading', () => {
    expect(rawNoteText('T', 'body')).toBe('# T\n\nbody')
  })

  it('returns the body alone without a title', () => {
    expect(rawNoteText('', 'body')).toBe('body')
  })
})

describe('copyableNoteText', () => {
  it('keeps markdown syntax', () => {
    expect(copyableNoteText('', '- a\n- **b**\n\n```ts\nx\n```')).toBe('- a\n- **b**\n\n```ts\nx\n```')
  })

  it('removes an inline local image', () => {
    expect(copyableNoteText('', 'see ![x](/img/a) here')).toBe('see  here')
  })

  it('drops an image-only line between paragraphs and keeps one blank line', () => {
    expect(copyableNoteText('', 'a\n\n![](/img/a)\n\nb')).toBe('a\n\nb')
  })

  it('drops adjacent image-only lines', () => {
    expect(copyableNoteText('', 'a\n\n![](/img/a)\n![](/img/b)\n\nb')).toBe('a\n\nb')
  })

  it('drops images at the start and end', () => {
    expect(copyableNoteText('', '![](/img/a)\n\nb\n\n![](/img/b)')).toBe('b')
  })

  it('joins lines around an image without blank lines', () => {
    expect(copyableNoteText('', 'a\n![](/img/a "t")\nb')).toBe('a\nb')
  })

  it('removes upload placeholders', () => {
    expect(copyableNoteText('', 'a\n\n![uploading-1]()\n\nb')).toBe('a\n\nb')
  })

  it('keeps external images as text', () => {
    expect(copyableNoteText('', '![x](https://example.com/a.png)')).toBe('![x](https://example.com/a.png)')
  })

  it('adds the title as a heading', () => {
    expect(copyableNoteText('T', '![](/img/a)\n\nbody')).toBe('# T\n\nbody')
  })

  it('returns only the title for an image-only note', () => {
    expect(copyableNoteText('T', '![](/img/a)')).toBe('# T')
  })
})
