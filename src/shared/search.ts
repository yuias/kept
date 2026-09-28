import { asciiLower, collapseLabelWhitespace } from './labels'
import { SEARCH_ATOMS_MAX, SEARCH_ATOM_MAX_CHARS, SEARCH_QUERY_MAX_CHARS } from './limits'

export type SearchAtom = { kind: 'text'; value: string } | { kind: 'label'; value: string }
export interface SearchQuery {
  groups: SearchAtom[][]
}
export type ParseResult = { ok: true; query: SearchQuery } | { ok: false; error: string }

type RawToken = { kind: 'text'; value: string } | { kind: 'label'; value: string } | { kind: 'or' }

/** Reads a quoted phrase starting at a `"`; an unterminated quote runs to the end of input. */
function readQuoted(input: string, start: number): { value: string; next: number } {
  const closing = input.indexOf('"', start + 1)
  if (closing === -1) return { value: input.slice(start + 1), next: input.length }
  return { value: input.slice(start + 1, closing), next: closing + 1 }
}

/** Reads an unquoted run up to the next whitespace (or end of input). */
function readWord(input: string, start: number): { value: string; next: number } {
  let i = start
  while (i < input.length && !/\s/.test(input[i]!)) i++
  return { value: input.slice(start, i), next: i }
}

/** Tokenizes the input into words, quoted phrases, `label:` atoms and bare `OR` markers. */
function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = []
  let i = 0

  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++
    if (i >= input.length) break

    if (asciiLower(input.slice(i, i + 6)) === 'label:') {
      const valueStart = i + 6
      if (input[valueStart] === '"') {
        const { value, next } = readQuoted(input, valueStart)
        tokens.push({ kind: 'label', value })
        i = next
      } else {
        const { value, next } = readWord(input, valueStart)
        tokens.push({ kind: 'label', value })
        i = next
      }
      continue
    }

    if (input[i] === '"') {
      const { value, next } = readQuoted(input, i)
      tokens.push({ kind: 'text', value })
      i = next
      continue
    }

    const { value, next } = readWord(input, i)
    tokens.push(value === 'OR' ? { kind: 'or' } : { kind: 'text', value })
    i = next
  }

  return tokens
}

/**
 * Parses the search grammar into an AND-of-OR-groups AST, enforcing the
 * `SEARCH_*` limits. Never throws: every rejection is reported through
 * `ParseResult`, since this is shared/runtime-neutral code.
 */
export function parseSearch(input: string): ParseResult {
  if (input.length > SEARCH_QUERY_MAX_CHARS) {
    return { ok: false, error: `search query must be at most ${SEARCH_QUERY_MAX_CHARS} characters` }
  }

  const groups: SearchAtom[][] = []
  let current: SearchAtom[] = []
  let pendingOr = false
  let atomCount = 0

  const pushAtom = (atom: SearchAtom): ParseResult | null => {
    if (atom.value.length > SEARCH_ATOM_MAX_CHARS) {
      return { ok: false, error: `a search term must be at most ${SEARCH_ATOM_MAX_CHARS} characters` }
    }
    atomCount += 1
    if (atomCount > SEARCH_ATOMS_MAX) {
      return { ok: false, error: `a search query may have at most ${SEARCH_ATOMS_MAX} terms` }
    }

    if (pendingOr) {
      current.push(atom)
    } else {
      if (current.length > 0) groups.push(current)
      current = [atom]
    }
    pendingOr = false
    return null
  }

  for (const token of tokenize(input)) {
    if (token.kind === 'or') {
      // Leading and repeated OR (nothing yet in the current group) are ignored.
      if (current.length > 0) pendingOr = true
      continue
    }

    if (token.kind === 'label') {
      const value = collapseLabelWhitespace(token.value)
      if (value.length === 0) continue // an empty label value is ignored
      const error = pushAtom({ kind: 'label', value })
      if (error) return error
      continue
    }

    // A plain text/phrase token with no content (e.g. an empty quoted phrase) is ignored too.
    if (token.value.length === 0) continue
    const error = pushAtom({ kind: 'text', value: token.value })
    if (error) return error
  }

  if (current.length > 0) groups.push(current)
  return { ok: true, query: { groups } }
}
