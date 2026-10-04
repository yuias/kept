import {
  LINK_PREVIEW_DESCRIPTION_MAX_CHARS,
  LINK_PREVIEW_SITE_NAME_MAX_CHARS,
  LINK_PREVIEW_TITLE_MAX_CHARS,
  LINK_PREVIEW_URL_MAX_CHARS,
} from '../shared/limits'
import type { LinkPreview } from '../shared/types'

/** Raw values exactly as seen in <head>; first occurrence wins for each key. */
export interface RawHead {
  meta: Record<string, string> // lowercased property-or-name -> content
  title: string | null // text of the first <title>
  icons: { rel: string; href: string }[] // <link> elements whose rel contains `icon`
}

/** Fed by the HTMLRewriter handlers; kept separate so it can be tested in node. */
export class HeadCollector {
  // Null-prototype so keys like `__proto__` in page markup are plain entries.
  private readonly metaValues: Record<string, string> = Object.create(null) as Record<string, string>
  private titleValue: string | null = null
  private titleClosed = false
  private readonly iconLinks: { rel: string; href: string }[] = []

  meta(property: string | null, name: string | null, content: string | null): void {
    if (content === null) return
    for (const key of [property, name]) {
      if (key === null) continue
      const normalized = key.trim().toLowerCase()
      if (normalized === '' || normalized in this.metaValues) continue
      this.metaValues[normalized] = content
    }
  }

  titleText(text: string, lastInTextNode: boolean): void {
    // Only the first <title> counts; its text node ends with lastInTextNode.
    if (this.titleClosed) return
    this.titleValue = (this.titleValue ?? '') + text
    if (lastInTextNode) this.titleClosed = true
  }

  link(rel: string | null, href: string | null): void {
    if (rel === null || href === null) return
    if (!rel.toLowerCase().includes('icon')) return
    this.iconLinks.push({ rel, href })
  }

  result(): RawHead {
    return { meta: { ...this.metaValues }, title: this.titleValue, icons: [...this.iconLinks] }
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

const MAX_CODE_POINT = 0x10ffff

/** Decodes &amp; &lt; &gt; &quot; &#39; &apos; &nbsp; and numeric (&#123; &#x1F600;) references. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (match, dec?: string, hex?: string, named?: string) => {
    if (named !== undefined) return NAMED_ENTITIES[named] ?? match
    const codePoint = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16)
    const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff
    if (codePoint === 0 || codePoint > MAX_CODE_POINT || isSurrogate) return match
    return String.fromCodePoint(codePoint)
  })
}

function cleanText(value: string | null | undefined, maxChars: number): string | null {
  if (value === null || value === undefined) return null
  const collapsed = decodeEntities(value).replace(/\s+/g, ' ').trim()
  if (collapsed === '') return null
  if (collapsed.length <= maxChars) return collapsed

  let cut = collapsed.slice(0, maxChars - 1)
  // Do not leave half of a surrogate pair before the ellipsis.
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1)
  return `${cut}…`
}

function firstText(raw: RawHead, keys: string[], maxChars: number): string | null {
  for (const key of keys) {
    const text = cleanText(raw.meta[key], maxChars)
    if (text !== null) return text
  }
  return null
}

function resolveHttpUrl(href: string, base: URL): string | null {
  let resolved: URL
  try {
    resolved = new URL(decodeEntities(href).trim(), base)
  } catch {
    return null
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
  const text = resolved.toString()
  return text.length <= LINK_PREVIEW_URL_MAX_CHARS ? text : null
}

function relTokens(rel: string): string[] {
  return rel.toLowerCase().split(/\s+/).filter((token) => token !== '')
}

function endsWithSvg(href: string, base: URL): boolean {
  try {
    return new URL(decodeEntities(href).trim(), base).pathname.toLowerCase().endsWith('.svg')
  } catch {
    return false
  }
}

function pickFaviconHref(raw: RawHead, finalUrl: URL): string {
  const plainIcon = raw.icons.find(
    (icon) => relTokens(icon.rel).includes('icon') && !endsWithSvg(icon.href, finalUrl),
  )
  if (plainIcon !== undefined) return plainIcon.href

  const touchIcon = raw.icons.find((icon) =>
    relTokens(icon.rel).some((token) => token === 'apple-touch-icon' || token === 'apple-touch-icon-precomposed'),
  )
  return touchIcon?.href ?? '/favicon.ico'
}

export function buildPreview(raw: RawHead, requestedUrl: string, finalUrl: URL): LinkPreview {
  const title =
    firstText(raw, ['og:title', 'twitter:title'], LINK_PREVIEW_TITLE_MAX_CHARS) ??
    cleanText(raw.title, LINK_PREVIEW_TITLE_MAX_CHARS)

  const imageHref = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image']
    .map((key) => raw.meta[key]?.trim())
    .find((value) => value !== undefined && value !== '')

  return {
    status: 'ok',
    url: requestedUrl,
    finalUrl: finalUrl.toString(),
    title,
    description: firstText(raw, ['og:description', 'twitter:description', 'description'], LINK_PREVIEW_DESCRIPTION_MAX_CHARS),
    siteName: firstText(raw, ['og:site_name'], LINK_PREVIEW_SITE_NAME_MAX_CHARS),
    image: imageHref === undefined ? null : resolveHttpUrl(imageHref, finalUrl),
    favicon: resolveHttpUrl(pickFaviconHref(raw, finalUrl), finalUrl),
  }
}
