import { syntaxTree } from '@codemirror/language'
import { type EditorState } from '@codemirror/state'
import { parseCardLine } from '../../../shared/link-card'

export interface CardLine {
  from: number
  to: number
  url: string
}

/** Syntax nodes whose contents are code or raw HTML, never markdown. */
const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock'])

export function isInCode(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state)
  // Check both sides so a position on a node boundary is judged by either neighbour.
  for (const side of [-1, 1] as const) {
    for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (CODE_NODES.has(node.name) && node.from <= pos && pos <= node.to) return true
    }
  }
  return false
}

/** Every card line in the document that is not inside code. */
export function collectCardLines(state: EditorState): CardLine[] {
  const cards: CardLine[] = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    if (!line.text.startsWith('@[card](')) continue
    const url = parseCardLine(line.text)
    if (url !== null && !isInCode(state, line.from)) cards.push({ from: line.from, to: line.to, url })
  }
  return cards
}
