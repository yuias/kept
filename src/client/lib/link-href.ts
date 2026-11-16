const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/

function parses(text: string): URL | null {
  try {
    return new URL(text)
  } catch {
    return null
  }
}

/**
 * The href for a link target as written in markdown, or null when it must stay
 * a plain styled span (relative paths, javascript:, data:, ftp:, ...).
 */
export function linkHref(raw: string): string | null {
  let text = raw.trim()
  // Lezer keeps the angle brackets of `[a](<b c>)` in the URL node.
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1).trim()
  if (text === '') return null

  if (SCHEME.test(text)) {
    const url = parses(text)
    return url && ALLOWED_PROTOCOLS.has(url.protocol) ? text : null
  }
  // GFM autolink literal without a scheme.
  if (text.toLowerCase().startsWith('www.')) {
    const href = `http://${text}`
    return parses(href) ? href : null
  }
  if (EMAIL.test(text)) return `mailto:${text}`
  return null
}
