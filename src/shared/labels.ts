import { LABEL_MAX_CHARS, LABELS_PER_NOTE_MAX } from './limits'

export type NormalizeLabelsResult = { ok: true; labels: string[] } | { ok: false; reason: 'comma' | 'too_long' | 'too_many'; error: string }

/**
 * SQLite's `COLLATE NOCASE` folds ASCII only, so the JS-side dedupe and sort
 * below must fold the same way, or a label like "café"/"CAFÉ" would dedupe
 * here but not in SQL (or vice versa), and sort order could disagree too.
 */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => ch.toLowerCase())
}

/** Splits a comma-separated text input (the editor's labels field) into raw parts. */
export function parseLabelInput(text: string): string[] {
  return text.split(',')
}

/** Trims and collapses inner whitespace, matching how a stored label name is normalized. */
export function collapseLabelWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/**
 * Trims, collapses inner whitespace, drops empties, and de-duplicates
 * case-insensitively while keeping the first spelling. Returns an error
 * (never throws, since this is shared/runtime-neutral code) if a label
 * exceeds `LABEL_MAX_CHARS`, still contains a comma (only possible when
 * called directly with an array, e.g. from the API, rather than through
 * `parseLabelInput`), or if there are more than `LABELS_PER_NOTE_MAX`.
 */
export function normalizeLabels(list: string[]): NormalizeLabelsResult {
  const seen = new Map<string, string>() // lowercase -> first spelling

  for (const raw of list) {
    if (raw.includes(',')) return { ok: false, reason: 'comma', error: 'a label cannot contain a comma' }

    const trimmed = collapseLabelWhitespace(raw)
    if (trimmed.length === 0) continue
    if (trimmed.length > LABEL_MAX_CHARS) {
      return { ok: false, reason: 'too_long', error: `a label must be at most ${LABEL_MAX_CHARS} characters` }
    }

    const key = asciiLower(trimmed)
    if (!seen.has(key)) seen.set(key, trimmed)
  }

  const labels = [...seen.values()]
  if (labels.length > LABELS_PER_NOTE_MAX) {
    return { ok: false, reason: 'too_many', error: `a note may have at most ${LABELS_PER_NOTE_MAX} labels` }
  }
  return { ok: true, labels }
}

/**
 * Matches the case-insensitive order labels are listed in everywhere they are
 * read back. Compares by code unit after an ASCII-only lowercase fold (not
 * `localeCompare`), so the order agrees with SQLite `COLLATE NOCASE`, which
 * is a plain ASCII-only byte/code-unit comparison, not locale-aware.
 */
export function sortLabelsCaseInsensitive(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const aLower = asciiLower(a)
    const bLower = asciiLower(b)
    if (aLower < bLower) return -1
    if (aLower > bLower) return 1
    return 0
  })
}
