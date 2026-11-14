import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type SelectionRange, type StateCommand } from '@codemirror/state'

export type InlineFormat = 'strong' | 'emphasis' | 'code' | 'strike'

const FORMATS: Record<InlineFormat, { marker: string; node: string; mark: string }> = {
  strong: { marker: '**', node: 'StrongEmphasis', mark: 'EmphasisMark' },
  emphasis: { marker: '*', node: 'Emphasis', mark: 'EmphasisMark' },
  code: { marker: '`', node: 'InlineCode', mark: 'CodeMark' },
  strike: { marker: '~~', node: 'Strikethrough', mark: 'StrikethroughMark' },
}

// @lezer/common is not a direct dependency, so the node type is derived.
type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

/** Smallest `node` element that encloses [from, to] and has an opening and a closing mark. */
function enclosing(state: EditorState, from: number, to: number, node: string, mark: string) {
  const tree = syntaxTree(state)
  let best: { node: SyntaxNode; open: SyntaxNode; close: SyntaxNode } | null = null
  // A cursor at an element's end resolves to the following node on the right side only.
  for (const side of [-1, 1] as const) {
    for (let candidate: SyntaxNode | null = tree.resolveInner(from, side); candidate; candidate = candidate.parent) {
      if (candidate.name !== node || candidate.from > from || to > candidate.to) continue
      const marks = candidate.getChildren(mark)
      const open = marks[0]
      const close = marks[marks.length - 1]
      if (marks.length < 2 || !open || !close) continue
      if (!best || candidate.to - candidate.from < best.node.to - best.node.from) best = { node: candidate, open, close }
    }
  }
  return best
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

// CodeMirror's own word lookup treats a whole run of kana/kanji as one word, which
// would wrap a full Japanese clause; the segmenter splits it into real words.
// Picks the word-like segment ending at or containing pos, else the one starting at pos.
function wordAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(pos)
  const offset = pos - line.from
  const segments = segmenter.segment(line.text)
  for (const at of [offset - 1, offset]) {
    if (at < 0 || at >= line.text.length) continue
    const seg = segments.containing(at)
    if (seg?.isWordLike) return { from: line.from + seg.index, to: line.from + seg.index + seg.segment.length }
  }
  return null
}

/** Toggles `format` for every selection range; does nothing (returns false) when read-only. */
export function toggleInlineFormat(format: InlineFormat): StateCommand {
  const { marker, node, mark } = FORMATS[format]

  return ({ state, dispatch }) => {
    if (state.readOnly) return false

    const perRange = (range: SelectionRange) => {
      const element = enclosing(state, range.from, range.to, node, mark)
      if (element) {
        const changes = state.changes([
          { from: element.open.from, to: element.open.to },
          { from: element.close.from, to: element.close.to },
        ])
        return {
          changes,
          range: EditorSelection.range(changes.mapPos(range.anchor), changes.mapPos(range.head)),
        }
      }

      if (range.empty) {
        const word = wordAt(state, range.head)
        if (!word) {
          return {
            changes: { from: range.head, insert: marker + marker },
            range: EditorSelection.cursor(range.head + marker.length),
          }
        }
        return {
          changes: [
            { from: word.from, insert: marker },
            { from: word.to, insert: marker },
          ],
          range: EditorSelection.cursor(range.head + marker.length),
        }
      }

      // A trailing space inside the markers (`**foo **`) would not parse as emphasis.
      const text = state.sliceDoc(range.from, range.to)
      let start = range.from
      let end = range.to
      while (start < end && /\s/.test(text.charAt(start - range.from))) start++
      while (end > start && /\s/.test(text.charAt(end - 1 - range.from))) end--
      if (start === end) return { range }

      const reversed = range.anchor > range.head
      const wrapped = [start + marker.length, end + marker.length]
      return {
        changes: [
          { from: start, insert: marker },
          { from: end, insert: marker },
        ],
        range: EditorSelection.range(wrapped[reversed ? 1 : 0] as number, wrapped[reversed ? 0 : 1] as number),
      }
    }

    dispatch(state.update(state.changeByRange(perRange), { scrollIntoView: true, userEvent: 'input.format' }))
    return true
  }
}
