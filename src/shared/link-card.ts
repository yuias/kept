/** `@[card](url)` alone on a line, starting at column 0. Trailing spaces/tabs allowed. */
export const CARD_LINE_PATTERN = /^@\[card\]\((\S+)\)[ \t]*$/

/** The card's URL when `line` is a card line with an absolute http(s) URL, else null. */
export function parseCardLine(line: string): string | null {
  const url = CARD_LINE_PATTERN.exec(line)?.[1]
  if (url === undefined) return null
  try {
    const { protocol } = new URL(url)
    // Return the captured text, not `href`, so the source and the fetched key match what the user sees.
    return protocol === 'http:' || protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function hasBalancedParens(text: string): boolean {
  let depth = 0
  for (const char of text) {
    if (char === '(') depth++
    else if (char === ')' && --depth < 0) return false
  }
  return depth === 0
}

/**
 * The card markup for `url`. Parentheses are kept verbatim when balanced
 * (Wikipedia-style URLs); when unbalanced, every `(` / `)` is percent-encoded
 * so the markdown link destination stays parseable.
 */
export function cardMarkup(url: string): string {
  const destination = hasBalancedParens(url) ? url : url.replace(/\(/g, '%28').replace(/\)/g, '%29')
  return `@[card](${destination})`
}
