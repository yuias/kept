/**
 * Pure string helpers for image placeholders in note body text. Kept free of
 * any DOM/editor dependency so the syntax textarea and the live editor share them.
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

/** Where `token` first occurs in `text`, or null if it is gone. */
export function placeholderRange(text: string, token: string): { from: number; to: number } | null {
  const at = text.indexOf(token)
  return at === -1 ? null : { from: at, to: at + token.length }
}

/**
 * Replaces the first occurrence of `token` with `markdown` (or removes it,
 * when `markdown` is `''`, on upload failure). Returns `text` unchanged if
 * `token` is no longer present, which happens if the note body was edited
 * away from under an in-flight upload.
 */
export function replacePlaceholder(text: string, token: string, markdown: string): string {
  const range = placeholderRange(text, token)
  if (!range) return text
  return text.slice(0, range.from) + markdown + text.slice(range.to)
}
