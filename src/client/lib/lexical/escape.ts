// Escaping for plain text in exported markdown. Both functions escape only what
// the app's own importer (stock transformers plus `unescapeText`, which reads
// every backslash + ASCII punctuation and numeric character references) would
// otherwise take for markup, so ordinary text stays as typed.

import { parseCardLine } from '../../../shared/link-card'

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/

const lastChar = (s: string): string => /.$/su.exec(s)?.[0] ?? ''
const firstChar = (s: string): string => /^./su.exec(s)?.[0] ?? ''

// Block edges count as whitespace, as in the CommonMark flanking rules.
const isSpace = (c: string): boolean => c === '' || /^\s$/u.test(c)
const isPunctuation = (c: string): boolean => /^[\p{P}\p{S}]$/u.test(c)

/**
 * What sits next to the edge of a text node in the export: the adjacent
 * character of a plain text neighbour ('' at a block edge), or the characters
 * of a delimiter the exporter writes there (`*` for bold and italic, `~`, a
 * backtick for code, `[` or `)` around a link).
 */
export type Edge = string | { delimiter: string }

interface Run {
  char: string
  start: number
  length: number
  paired: boolean
}

// `[` with a later `](` is link, image or card syntax. A character reference
// is only decoded by the importer when it is complete, so `&` needs a guard
// only in front of one.
const CHARACTER_REFERENCE = /^&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6});/

/**
 * Escapes `text` for a plain text node. `before` and `after` describe the
 * neighbours (see `Edge`); they decide whether a run of `*`, `_` or `~` at the
 * edge of `text` can open or close emphasis. A delimiter counts as
 * punctuation, and a run of the same character touching it is always escaped,
 * because it would merge with the delimiter. Unpaired runs elsewhere (`2 * 3`,
 * `foo_bar`) are left alone.
 *
 * A `[` that opens `![label](` is escaped only when `imageSyntax` is set, that
 * is once the importer reads images; before that it stays plain text and must
 * keep its bytes. A `[` with an empty label that is not part of `![` is never
 * markup for the importer, so it is left alone.
 *
 * `range` limits the output to that slice of `text`: the rest only supplies
 * context, so that a pair opened in one node and closed in the next is found.
 */
export function escapePlainText(text: string, before: Edge, after: Edge, imageSyntax = false, range: [number, number] = [0, text.length]): string {
  // One pass over the original text: every rule adds indexes, so a backslash
  // added by one rule is never escaped again by another.
  const escaped = new Set<number>()
  const beforeChar = typeof before === 'string' ? lastChar(before) : lastChar(before.delimiter)
  const afterChar = typeof after === 'string' ? firstChar(after) : firstChar(after.delimiter)
  const touchesDelimiter = (char: string, start: number, end: number): boolean =>
    (start === 0 && typeof before !== 'string' && before.delimiter.includes(char)) ||
    (end === text.length && typeof after !== 'string' && after.delimiter.includes(char))

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') continue
    const next = i + 1 < text.length ? text.charAt(i + 1) : afterChar
    if (ASCII_PUNCTUATION.test(next)) escaped.add(i)
  }

  const runs: Run[] = [...text.matchAll(/\*+|_+|~+/g)].map((m) => ({
    char: m[0].charAt(0),
    start: m.index,
    length: m[0].length,
    paired: touchesDelimiter(m[0].charAt(0), m.index, m.index + m[0].length),
  }))
  // Each character of an opening run is its own opener, so `**` closed by `*`
  // still pairs both runs; openers in between are kept (escaping more is safe).
  const openers: Run[] = []
  for (const run of runs) {
    const prev = run.start > 0 ? lastChar(text.slice(0, run.start)) : beforeChar
    const end = run.start + run.length
    const next = end < text.length ? firstChar(text.slice(end)) : afterChar
    const left = !isSpace(next) && (!isPunctuation(next) || isSpace(prev) || isPunctuation(prev))
    const right = !isSpace(prev) && (!isPunctuation(prev) || isSpace(next) || isPunctuation(next))
    const canOpen = run.char === '_' ? left && (!right || isPunctuation(prev)) : left
    const canClose = run.char === '_' ? right && (!left || isPunctuation(next)) : right

    let unmatched = run.length
    if (canClose) {
      while (unmatched > 0) {
        const index = openers.map((o) => o.char).lastIndexOf(run.char)
        if (index < 0) break
        openers[index]!.paired = true
        run.paired = true
        openers.splice(index, 1)
        unmatched--
      }
    }
    if (canOpen) for (let i = 0; i < unmatched; i++) openers.push(run)
  }
  for (const run of runs) {
    if (!run.paired) continue
    for (let i = run.start; i < run.start + run.length; i++) escaped.add(i)
  }

  const backtickRuns = [...text.matchAll(/`+/g)]
  const lengths = backtickRuns.map((m) => m[0].length)
  const equalRuns = lengths.some((length, i) => lengths.indexOf(length) !== i)
  for (const m of backtickRuns) {
    if (!equalRuns && !touchesDelimiter('`', m.index, m.index + m[0].length)) continue
    for (let i = m.index; i < m.index + m[0].length; i++) escaped.add(i)
  }

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[' && text.includes('](', i)) {
      const emptyLabel = text.startsWith('](', i + 1)
      const imageStart = (i > 0 ? text[i - 1] : beforeChar) === '!'
      if (!emptyLabel || (imageSyntax && imageStart)) escaped.add(i)
    } else if (text[i] === '&' && CHARACTER_REFERENCE.test(text.slice(i))) escaped.add(i)
  }

  let out = ''
  for (let i = range[0]; i < range[1]; i++) out += (escaped.has(i) ? '\\' : '') + text[i]
  return out
}

/** What the importer reads as a thematic break; the rule transformer matches the same lines. */
export const THEMATIC_BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/

export interface LineStartBlocks {
  /** Thematic break lines (`---`, `* * *`); on while the importer reads them as a rule. */
  thematicBreak: boolean
  /** The line starts with `|` and the importer would read it as part of a table (`isTableStart`); another `|` line is plain text. */
  tableRow: boolean
}

/**
 * Escapes a line that would read as a block when it starts a paragraph: ATX
 * heading, quote, list item, task item, fence, card line, table row or thematic break. The last two
 * only count while the importer turns them into blocks (`blocks`); before
 * that, such a line is an ordinary paragraph and must keep its bytes. The
 * importer reads `\s` after a marker (tab and U+3000 included) and any number
 * of digits, so the patterns follow it where it is wider than CommonMark.
 */
export function escapeLineStart(
  line: string,
  blocks: LineStartBlocks = { thematicBreak: true, tableRow: true },
): string {
  const insertAt = (index: number): string => `${line.slice(0, index)}\\${line.slice(index)}`
  const indent = /^\s*/.exec(line)?.[0].length ?? 0
  const rest = line.slice(indent)

  if (/^(?:[-+*]\s|\d+\.\s|\d{1,9}[.)](?: |$))/.test(rest)) {
    return insertAt(indent + (/^[-+*]/.test(rest) ? 0 : /^\d+/.exec(rest)![0].length))
  }
  // The check list pattern makes its `- ` marker optional, so `[ ] x` alone is a task item.
  if (/^\s*\[(?:\s|x)?\]\s/i.test(line)) return insertAt(indent)
  if (/^(?:#{1,6}(?:\s|$)|>)/.test(line) || (blocks.tableRow && line.startsWith('|'))) return insertAt(0)
  // The importer opens a code block on any line that starts with three backticks.
  const fenceIndent = /^[ \t]*(?:`{3,}|~{3,})/.test(line) ? /^[ \t]*/.exec(line)![0].length : -1
  if (fenceIndent >= 0) return insertAt(fenceIndent)
  // `@` + a link typed in the editor writes a card line, which the importer turns into a card.
  if (parseCardLine(line) !== null) return insertAt(0)
  return blocks.thematicBreak && THEMATIC_BREAK.test(line) ? insertAt(indent) : line
}
