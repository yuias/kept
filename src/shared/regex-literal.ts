/**
 * Extracts the longest top-level literal run a regex match must contain, so
 * `search-sql.ts` can narrow a scan with a plain `instr` before running the
 * regex in JS. Returning `null` just means "no narrowing", never an error:
 * every bail-out below only loses an optimization, it never changes which
 * notes match.
 */

const ESCAPABLE_LITERAL = new Set('.\\*+?()[]{}|^$-/')
const CLASS_ESCAPE_LETTERS = new Set('dDwWsSbBnrtfv')
const BAILOUT_ESCAPE_LETTERS = new Set('xuUpPkc')
const NON_ASCII = /[^\x00-\x7f]/

/** Drops a whole code point so a trimmed astral character never leaves a lone surrogate. */
function dropLastCodePoint(text: string): string {
  return Array.from(text).slice(0, -1).join('')
}

type RunState = 'none' | 'literal' | 'other' | 'quantifier'

/** Skips a `{n}` / `{n,}` / `{n,m}` quantifier body, reporting whether its minimum is 0. */
function readBraceQuantifier(source: string, openIndex: number): { end: number; minZero: boolean } | null {
  const match = /^\{(\d+)(,(\d*)?)?\}/.exec(source.slice(openIndex))
  if (!match) return null
  const min = Number(match[1])
  return { end: openIndex + match[0].length, minZero: min === 0 }
}

export function requiredLiteral(source: string, flags: string): string | null {
  const runs: string[] = []
  let run = ''
  let last: RunState = 'none'
  let depth = 0
  let inClass = false

  const endRun = (state: RunState) => {
    if (run.length > 0) runs.push(run)
    run = ''
    last = state
  }

  let i = 0
  while (i < source.length) {
    const ch = source[i]!

    if (inClass) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === ']') {
        inClass = false
      }
      i += 1
      continue
    }

    if (ch === '\\') {
      const next = source[i + 1]
      if (next === undefined) return null // trailing backslash: not a valid pattern anyway
      if (ESCAPABLE_LITERAL.has(next)) {
        if (depth === 0) run += next
        last = 'literal'
        i += 2
        continue
      }
      if (next >= '0' && next <= '9') {
        // Backreference or legacy octal escape: not a literal, and any following digits belong to it.
        if (depth === 0) endRun('other')
        i += 2
        while (i < source.length && source[i]! >= '0' && source[i]! <= '9') i++
        continue
      }
      if (CLASS_ESCAPE_LETTERS.has(next)) {
        if (depth === 0) endRun('other')
        i += 2
        continue
      }
      if (BAILOUT_ESCAPE_LETTERS.has(next)) return null
      // Any other escaped char (e.g. a literal letter) behaves like the char itself.
      if (depth === 0) run += next
      last = 'literal'
      i += 2
      continue
    }

    if (ch === '|' && depth === 0) return null

    if (ch === '(') {
      depth += 1
      if (depth === 1) endRun('other')
      i += 1
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      if (depth === 0) last = 'other'
      i += 1
      continue
    }
    if (ch === '[') {
      inClass = true
      if (depth === 0) endRun('other')
      i += 1
      continue
    }

    if (depth > 0) {
      i += 1
      continue
    }

    // A lazy `?` right after a quantifier only changes greediness, not the run.
    if (last === 'quantifier' && ch === '?') {
      last = 'other'
      i += 1
      continue
    }

    if (ch === '.' || ch === '^' || ch === '$') {
      endRun('other')
      i += 1
      continue
    }

    if (ch === '?' || ch === '*') {
      if (last === 'literal') {
        run = dropLastCodePoint(run)
        endRun('quantifier')
      } else {
        last = 'quantifier'
      }
      i += 1
      continue
    }
    if (ch === '+') {
      if (last === 'literal') {
        endRun('quantifier')
      } else {
        last = 'quantifier'
      }
      i += 1
      continue
    }
    if (ch === '{') {
      const brace = readBraceQuantifier(source, i)
      if (!brace) {
        // Not a valid `{n,m}` quantifier: JS regex treats a lone `{` as a literal.
        run += ch
        last = 'literal'
        i += 1
        continue
      }
      if (last === 'literal') {
        if (brace.minZero) run = dropLastCodePoint(run)
        endRun('quantifier')
      } else {
        last = 'quantifier'
      }
      i = brace.end
      continue
    }
    if (ch === '}') {
      // A lone `}` with no matching `{n,m}` above is a literal brace in JS regex syntax.
      run += ch
      last = 'literal'
      i += 1
      continue
    }

    run += ch
    last = 'literal'
    i += 1
  }
  endRun('other')

  const candidates = runs.filter((candidate) => candidate.length >= 3)
  if (candidates.length === 0) return null

  // Strict `>` keeps the first run on a tie.
  let best = candidates[0]!
  for (const candidate of candidates) {
    if (candidate.length > best.length) best = candidate
  }

  if (flags.includes('i')) {
    if (NON_ASCII.test(best)) return null
    // Unicode case folding also matches U+212A and U+017F, which SQL lower() would miss.
    if (flags.includes('u') && /[ks]/i.test(best)) return null
  }
  return best
}
