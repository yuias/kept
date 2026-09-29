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
