import { asciiLower, collapseLabelWhitespace } from './labels'
import { REGEX_SOURCE_MAX_CHARS, SEARCH_ATOMS_MAX, SEARCH_ATOM_MAX_CHARS, SEARCH_QUERY_MAX_CHARS } from './limits'

export type SearchAtom =
  | { kind: 'text'; value: string }
  | { kind: 'label'; value: string }
  | { kind: 'regex'; source: string; flags: string }
export interface SearchQuery {
  groups: SearchAtom[][]
}
export type ParseResult = { ok: true; query: SearchQuery } | { ok: false; error: string }

/** Flags `new RegExp` accepts that also make sense for a single-row scan (see Design). */
const ALLOWED_REGEX_FLAGS = new Set(['i', 'm', 's', 'u'])

/** Heuristic for a pattern with a nested quantifier, which can backtrack catastrophically. */
const SLOW_PATTERN_HEURISTIC = /\([^)]*[+*][^)]*\)[+*{]/

type RawToken =
  | { kind: 'text'; value: string }
  | { kind: 'label'; value: string }
  | { kind: 'regex'; source: string; flags: string }
  | { kind: 'or' }

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

/**
 * Reads a `/pattern/flags` token starting at the `/` at `start`. Scans to the
 * *first* unescaped `/` that is followed by a run of letters and then
 * whitespace or end of input, so a pattern may itself contain spaces and
 * escaped slashes. Returns `null` when no such closer exists (e.g. `path/to`
 * or an unterminated `/foo`), so the caller falls back to a plain word.
 */
function readRegex(input: string, start: number): { source: string; flags: string; next: number } | null {
  let closer = -1
  let flagsEnd = -1

  for (let j = start + 1; j < input.length; j++) {
    if (input[j] !== '/') continue

    let backslashes = 0
    let k = j - 1
    while (k >= start + 1 && input[k] === '\\') {
      backslashes++
      k--
    }
    if (backslashes % 2 !== 0) continue // an escaped slash, not a closer

    let f = j + 1
    while (f < input.length && /[a-zA-Z]/.test(input[f]!)) f++
    if (f < input.length && !/\s/.test(input[f]!)) continue // flags run into non-whitespace, non-letter text

    closer = j
    flagsEnd = f
    break
  }

  if (closer === -1) return null
  return { source: input.slice(start + 1, closer), flags: input.slice(closer + 1, flagsEnd), next: flagsEnd }
}

/** Returns an error message for an unusable regex atom, or `null` when it is acceptable. */
function validateRegex(source: string, flags: string): string | null {
  if (source.length === 0) return 'a regex must not be empty'
  if (source.length > REGEX_SOURCE_MAX_CHARS) {
    return `a regex must be at most ${REGEX_SOURCE_MAX_CHARS} characters`
  }
  for (const flag of flags) {
    if (!ALLOWED_REGEX_FLAGS.has(flag)) return `unsupported regex flag "${flag}" (allowed: imsu)`
  }
  try {
    new RegExp(source, flags)
  } catch {
    return 'invalid regular expression'
  }
  if (SLOW_PATTERN_HEURISTIC.test(source)) return 'pattern may be too slow'
  return null
}

/** Tokenizes the input into words, quoted phrases, `label:` and `/regex/` atoms and bare `OR` markers. */
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

    if (input[i] === '/') {
      const regex = readRegex(input, i)
      if (regex) {
        tokens.push({ kind: 'regex', source: regex.source, flags: regex.flags })
        i = regex.next
        continue
      }
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
    if (atom.kind !== 'regex' && atom.value.length > SEARCH_ATOM_MAX_CHARS) {
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

    if (token.kind === 'regex') {
      const invalid = validateRegex(token.source, token.flags)
      if (invalid) return { ok: false, error: invalid }
      const error = pushAtom({ kind: 'regex', source: token.source, flags: token.flags })
      if (error) return error
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
