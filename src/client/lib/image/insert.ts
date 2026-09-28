/**
 * Pure string helpers for image placeholders in note body text. Kept free of
 * any DOM/editor dependency so the live editor (later) can reuse them.
 */

/** A unique placeholder inserted at the cursor while an image upload runs. */
export function makePlaceholder(): string {
  return `![uploading-${crypto.randomUUID()}]()`
}

/** Inserts `s` into `text` at `pos`, clamped to the text's bounds. */
export function insertAt(text: string, pos: number, s: string): string {
  const at = Math.max(0, Math.min(pos, text.length))
  return text.slice(0, at) + s + text.slice(at)
}

/**
 * Replaces the first occurrence of `token` with `markdown` (or removes it,
 * when `markdown` is `''`, on upload failure). Returns `text` unchanged if
 * `token` is no longer present, which happens if the note body was edited
 * away from under an in-flight upload.
 */
export function replacePlaceholder(text: string, token: string, markdown: string): string {
  const at = text.indexOf(token)
  if (at === -1) return text
  return text.slice(0, at) + markdown + text.slice(at + token.length)
}
