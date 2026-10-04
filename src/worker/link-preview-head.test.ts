import { describe, expect, it } from 'vitest'
import {
  LINK_PREVIEW_DESCRIPTION_MAX_CHARS,
  LINK_PREVIEW_SITE_NAME_MAX_CHARS,
  LINK_PREVIEW_TITLE_MAX_CHARS,
  LINK_PREVIEW_URL_MAX_CHARS,
} from '../shared/limits'
import { buildPreview, decodeEntities, HeadCollector, type RawHead } from './link-preview-head'

const FINAL = new URL('https://example.com/articles/post?id=1')

function raw(partial: Partial<RawHead> = {}): RawHead {
  return { meta: {}, title: null, icons: [], ...partial }
}

describe('HeadCollector', () => {
  it('keys meta by property or name, lowercased, first occurrence wins', () => {
    const collector = new HeadCollector()
    collector.meta('OG:Title', null, 'First')
    collector.meta('og:title', null, 'Second')
    collector.meta(null, 'Description', 'By name')
    collector.meta(null, 'description', 'Later')
    collector.meta(null, null, 'orphan')
    collector.meta('og:image', null, null)

    expect(collector.result().meta).toEqual({ 'og:title': 'First', description: 'By name' })
  })

  it('joins a title split over several text chunks and ignores a second title', () => {
    const collector = new HeadCollector()
    collector.titleText('Hello, ', false)
    collector.titleText('wor', false)
    collector.titleText('ld', true)
    collector.titleText('Other', false)
    collector.titleText('', true)

    expect(collector.result().title).toBe('Hello, world')
  })

  it('keeps only links whose rel contains icon', () => {
    const collector = new HeadCollector()
    collector.link('stylesheet', '/a.css')
    collector.link('Shortcut Icon', '/favicon.png')
    collector.link('apple-touch-icon', '/touch.png')
    collector.link(null, '/x')
    collector.link('icon', null)

    expect(collector.result().icons).toEqual([
      { rel: 'Shortcut Icon', href: '/favicon.png' },
      { rel: 'apple-touch-icon', href: '/touch.png' },
    ])
  })

  it('treats prototype-named meta keys as plain data', () => {
    const collector = new HeadCollector()
    collector.meta('constructor', null, 'x')
    collector.meta('toString', null, 'y')
    expect(Object.keys(collector.result().meta)).toEqual(['constructor', 'tostring'])
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric references', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f&apos;')).toBe(`a & b <c> "d" 'e' 'f'`)
    expect(decodeEntities('&#123;&#x1F600;&#X41;')).toBe('{\u{1F600}A')
    expect(decodeEntities('a&nbsp;b')).toBe('a b')
  })

  it('leaves unknown or invalid references untouched', () => {
    expect(decodeEntities('&foo; &#0; &#xD800; &#99999999; & x;')).toBe('&foo; &#0; &#xD800; &#99999999; & x;')
  })

  it('does not decode twice', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
  })
})

describe('buildPreview text fields', () => {
  it('prefers og values over twitter and document fallbacks', () => {
    const preview = buildPreview(
      raw({
        meta: {
          'og:title': 'OG title',
          'twitter:title': 'TW title',
          'og:description': 'OG desc',
          'twitter:description': 'TW desc',
          description: 'Plain desc',
          'og:site_name': 'Site',
        },
        title: 'Doc title',
      }),
      'https://example.com/articles/post?id=1',
      FINAL,
    )

    expect(preview).toMatchObject({
      status: 'ok',
      url: 'https://example.com/articles/post?id=1',
      finalUrl: FINAL.toString(),
      title: 'OG title',
      description: 'OG desc',
      siteName: 'Site',
    })
  })

  it('falls back to twitter, then <title> and description', () => {
    expect(buildPreview(raw({ meta: { 'twitter:title': 'TW', 'twitter:description': 'TWD' }, title: 'Doc' }), 'u', FINAL)).toMatchObject({
      title: 'TW',
      description: 'TWD',
    })
    expect(buildPreview(raw({ meta: { description: 'Plain' }, title: 'Doc' }), 'u', FINAL)).toMatchObject({
      title: 'Doc',
      description: 'Plain',
      siteName: null,
    })
  })

  it('falls through blank og values', () => {
    expect(buildPreview(raw({ meta: { 'og:title': '  \n ' }, title: 'Doc' }), 'u', FINAL).title).toBe('Doc')
  })

  it('returns null fields for an empty head', () => {
    expect(buildPreview(raw(), 'u', FINAL)).toMatchObject({
      title: null,
      description: null,
      siteName: null,
      image: null,
    })
  })

  it('decodes entities and collapses whitespace', () => {
    const preview = buildPreview(raw({ title: '  Tom &amp;\n\t Jerry  &#8212;   Fun&nbsp;Times ' }), 'u', FINAL)
    expect(preview.title).toBe('Tom & Jerry — Fun Times')
  })

  it('truncates at each limit with an ellipsis', () => {
    const preview = buildPreview(
      raw({
        meta: {
          'og:title': 'a'.repeat(LINK_PREVIEW_TITLE_MAX_CHARS + 10),
          'og:description': 'b'.repeat(LINK_PREVIEW_DESCRIPTION_MAX_CHARS + 10),
          'og:site_name': 'c'.repeat(LINK_PREVIEW_SITE_NAME_MAX_CHARS + 10),
        },
      }),
      'u',
      FINAL,
    )

    expect(preview.title).toBe(`${'a'.repeat(LINK_PREVIEW_TITLE_MAX_CHARS - 1)}…`)
    expect(preview.description).toBe(`${'b'.repeat(LINK_PREVIEW_DESCRIPTION_MAX_CHARS - 1)}…`)
    expect(preview.siteName).toBe(`${'c'.repeat(LINK_PREVIEW_SITE_NAME_MAX_CHARS - 1)}…`)
  })

  it('does not truncate text exactly at the limit', () => {
    const title = 'a'.repeat(LINK_PREVIEW_TITLE_MAX_CHARS)
    expect(buildPreview(raw({ title }), 'u', FINAL).title).toBe(title)
  })

  it('does not split a surrogate pair when truncating', () => {
    const title = `${'a'.repeat(LINK_PREVIEW_TITLE_MAX_CHARS - 2)}\u{1F600}tail`
    const result = buildPreview(raw({ title }), 'u', FINAL).title ?? ''
    expect(result).toBe(`${'a'.repeat(LINK_PREVIEW_TITLE_MAX_CHARS - 2)}…`)
  })
})

describe('buildPreview image', () => {
  it('uses og:image, then og:image:url, og:image:secure_url, twitter:image', () => {
    const order = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image']
    for (let index = 0; index < order.length; index += 1) {
      const meta = Object.fromEntries(order.slice(index).map((key) => [key, `https://img.example/${key}.png`]))
      expect(buildPreview(raw({ meta }), 'u', FINAL).image).toBe(`https://img.example/${order[index]}.png`)
    }
  })

  it('decodes entities in the URL', () => {
    const preview = buildPreview(raw({ meta: { 'og:image': 'https://img.example/a.png?x=1&amp;y=2' } }), 'u', FINAL)
    expect(preview.image).toBe('https://img.example/a.png?x=1&y=2')
  })

  it('resolves relative URLs against the final URL', () => {
    const redirected = new URL('https://other.example/dir/page')
    expect(buildPreview(raw({ meta: { 'og:image': '/img/a.png' } }), 'u', redirected).image).toBe('https://other.example/img/a.png')
    expect(buildPreview(raw({ meta: { 'og:image': 'a.png' } }), 'u', redirected).image).toBe('https://other.example/dir/a.png')
    expect(buildPreview(raw({ meta: { 'og:image': '//cdn.example/a.png' } }), 'u', redirected).image).toBe('https://cdn.example/a.png')
  })

  it('rejects non-http(s), unparsable and overlong URLs', () => {
    for (const value of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://[bad']) {
      expect(buildPreview(raw({ meta: { 'og:image': value } }), 'u', FINAL).image).toBeNull()
    }
    const overlong = `https://img.example/${'a'.repeat(LINK_PREVIEW_URL_MAX_CHARS)}`
    expect(buildPreview(raw({ meta: { 'og:image': overlong } }), 'u', FINAL).image).toBeNull()
  })
})

describe('buildPreview favicon', () => {
  it('falls back to /favicon.ico on the final origin', () => {
    expect(buildPreview(raw(), 'u', FINAL).favicon).toBe('https://example.com/favicon.ico')
  })

  it('prefers a non-SVG icon, counting "shortcut icon", and resolves it against the final URL', () => {
    const redirected = new URL('https://other.example/dir/page')
    const preview = buildPreview(
      raw({
        icons: [
          { rel: 'apple-touch-icon', href: '/touch.png' },
          { rel: 'shortcut icon', href: 'fav.png' },
        ],
      }),
      'u',
      redirected,
    )
    expect(preview.favicon).toBe('https://other.example/dir/fav.png')
  })

  it('skips .svg icons, then uses apple-touch-icon, then /favicon.ico', () => {
    const svgOnly = [{ rel: 'icon', href: '/icon.SVG?v=2' }]
    expect(buildPreview(raw({ icons: svgOnly }), 'u', FINAL).favicon).toBe('https://example.com/favicon.ico')

    const withTouch = [...svgOnly, { rel: 'apple-touch-icon', href: '/touch.png' }]
    expect(buildPreview(raw({ icons: withTouch }), 'u', FINAL).favicon).toBe('https://example.com/touch.png')
  })

  it('picks a later non-SVG icon over an earlier SVG one', () => {
    const icons = [
      { rel: 'icon', href: '/icon.svg' },
      { rel: 'icon', href: '/icon.png' },
    ]
    expect(buildPreview(raw({ icons }), 'u', FINAL).favicon).toBe('https://example.com/icon.png')
  })

  it('does not treat apple-touch-icon as a plain icon', () => {
    const icons = [{ rel: 'apple-touch-icon', href: '/touch.png' }]
    expect(buildPreview(raw({ icons }), 'u', FINAL).favicon).toBe('https://example.com/touch.png')
  })

  it('decodes entities and rejects non-http(s) icons', () => {
    expect(buildPreview(raw({ icons: [{ rel: 'icon', href: '/i.png?a=1&amp;b=2' }] }), 'u', FINAL).favicon).toBe(
      'https://example.com/i.png?a=1&b=2',
    )
    for (const href of ['javascript:alert(1)', 'data:image/png;base64,AAAA']) {
      expect(buildPreview(raw({ icons: [{ rel: 'icon', href }] }), 'u', FINAL).favicon).toBeNull()
    }
  })
})
