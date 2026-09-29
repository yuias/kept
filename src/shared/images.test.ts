import { describe, expect, it } from 'vitest'
import { extractImageUrls, isLocalImageUrl } from './images'

describe('isLocalImageUrl', () => {
  it('accepts /img/<id> only', () => {
    expect(isLocalImageUrl('/img/a-1_B')).toBe(true)
    for (const url of ['https://example.com/a.png', '//evil/img/x', '/img/a/b', '/img/a?x=1', '/img/', '</img/x>', '']) {
      expect(isLocalImageUrl(url)).toBe(false)
    }
  })
})

describe('extractImageUrls', () => {
  it('reads a plain image', () => {
    expect(extractImageUrls('![](/img/a)', 4)).toEqual(['/img/a'])
  })

  it('ignores an optional title', () => {
    expect(extractImageUrls('![alt](/img/a "title")', 4)).toEqual(['/img/a'])
    expect(extractImageUrls("![alt](/img/a 'title')", 4)).toEqual(['/img/a'])
  })

  it('accepts alt text spanning lines', () => {
    expect(extractImageUrls('![a\nb](/img/x)', 4)).toEqual(['/img/x'])
  })

  it('skips upload placeholders', () => {
    expect(extractImageUrls('![uploading-6f1c2a3e-0000-4000-8000-000000000000]()', 4)).toEqual([])
  })

  it('skips non-local and malformed targets', () => {
    const urls = ['https://example.com/a.png', '//evil/img/x', '/img/a/b', '/img/a?x=1', '/img/', '</img/x>']
    for (const url of urls) expect(extractImageUrls(`![](${url})`, 4)).toEqual([])
  })

  it('collapses duplicates', () => {
    expect(extractImageUrls('![](/img/a) ![](/img/a)', 4)).toEqual(['/img/a'])
  })

  it('caps the result at max, keeping document order', () => {
    const md = ['a', 'b', 'c', 'd', 'e'].map((id) => `![](/img/${id})`).join('\n')
    expect(extractImageUrls(md, 4)).toEqual(['/img/a', '/img/b', '/img/c', '/img/d'])
  })

  it('does not count skipped or duplicate images against max', () => {
    const md = '![](/img/a) ![](https://x.test/y.png) ![](/img/a) ![](/img/b)'
    expect(extractImageUrls(md, 2)).toEqual(['/img/a', '/img/b'])
  })

  it('ignores a truncated tail', () => {
    expect(extractImageUrls('![](/img/a) ![](/img/b', 4)).toEqual(['/img/a'])
  })

  it('ignores regular links and surrounding text', () => {
    const md = 'intro [x](/img/c) text\n\n![](/img/a)\n\nmore ![b](/img/b "t") end'
    expect(extractImageUrls(md, 4)).toEqual(['/img/a', '/img/b'])
  })

  it('returns nothing for max 0', () => {
    expect(extractImageUrls('![](/img/a)', 0)).toEqual([])
  })
})
