// Only images this app serves. Anything else stays as source text so neither
// the editor nor the cards fetch arbitrary external URLs (tracking, mixed content).
export const LOCAL_IMAGE_URL = /^\/img\/[\w-]+$/

export function isLocalImageUrl(url: string): boolean {
  return LOCAL_IMAGE_URL.test(url)
}

// Alt may span lines, like the live editor. A `<url>` target fails the local check.
const IMAGE_SYNTAX = /!\[[^\]]*\]\((\S+?)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g

/**
 * Local image URLs from `![alt](url)` / `![alt](url "title")` in markdown,
 * in document order, de-duplicated, at most `max`. Upload placeholders
 * (`![uploading-…]()`) have an empty URL and are skipped.
 */
export function extractImageUrls(markdown: string, max: number): string[] {
  const urls = new Set<string>()
  for (const match of markdown.matchAll(IMAGE_SYNTAX)) {
    if (urls.size >= max) break
    const url = match[1]
    if (url !== undefined && isLocalImageUrl(url)) urls.add(url)
  }
  return [...urls]
}

// Upload placeholders have an empty target, so IMAGE_SYNTAX does not match them.
const UPLOAD_PLACEHOLDER = /!\[uploading-[^\]]*\]\(\)/g

/**
 * Removes local images and upload placeholders from markdown; external image
 * syntax stays, as it is only text in this app. A line left empty by the
 * removal is dropped together with one adjacent blank line, so paragraphs
 * keep a single blank line between them.
 */
export function stripLocalImages(markdown: string): string {
  const out: string[] = []
  // Set after dropping a line that followed a blank line (or the start), so
  // the blank line after it is dropped too.
  let skipNextBlank = false
  for (const line of markdown.split('\n')) {
    const stripped = line
      .replace(IMAGE_SYNTAX, (match, url: string) => (isLocalImageUrl(url) ? '' : match))
      .replace(UPLOAD_PLACEHOLDER, '')
    if (stripped !== line && stripped.trim() === '') {
      if (out.length === 0 || out[out.length - 1]?.trim() === '') skipNextBlank = true
      continue
    }
    if (skipNextBlank && line.trim() === '') {
      skipNextBlank = false
      continue
    }
    skipNextBlank = false
    out.push(stripped)
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '')
}
