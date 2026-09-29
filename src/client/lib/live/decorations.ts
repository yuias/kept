/**
 * Live-preview decorations for the markdown editor. Everything here is view
 * state only: the document text is never touched, so the saved body stays
 * exactly what the user typed.
 */
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

export type LiveSpec =
  | { kind: 'line'; from: number; className: string }
  | { kind: 'mark'; from: number; to: number; className: string }
  | { kind: 'hide'; from: number; to: number }

interface TextRange {
  from: number
  to: number
}

export const MARKER_CLASS = 'cm-live-marker'

/** 1-based numbers of every line touched by a selection range. */
export function activeLineNumbers(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

/**
 * Maps the syntax tree over `ranges` to decoration specs. Kept separate from
 * the `Decoration` objects so the hiding rules can be tested against a plain
 * `EditorState`, without a DOM.
 */
export function collectSpecs(state: EditorState, ranges: readonly TextRange[]): LiveSpec[] {
  const { doc } = state
  const active = activeLineNumbers(state)
  const specs: LiveSpec[] = []

  // A marker is hidden only when its line has no cursor/selection. A range
  // that spans lines cannot be replaced from a plugin, so it stays visible.
  const marker = (from: number, to: number): void => {
    if (from >= to) return
    const first = doc.lineAt(from).number
    const sameLine = first === doc.lineAt(to).number
    if (sameLine && !active.has(first)) specs.push({ kind: 'hide', from, to })
    else specs.push({ kind: 'mark', from, to, className: MARKER_CLASS })
  }
  const mark = (from: number, to: number, className: string): void => {
    if (from < to) specs.push({ kind: 'mark', from, to, className })
  }

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter: (ref) => {
        const { name } = ref
        const atx = /^ATXHeading([1-6])$/.exec(name)
        if (atx) {
          const level = atx[1]
          specs.push({ kind: 'line', from: doc.lineAt(ref.from).from, className: `cm-live-h${level}` })
          const marks = ref.node.getChildren('HeaderMark')
          const open = marks[0]
          if (open) {
            const line = doc.lineAt(open.from)
            const hasText = doc.sliceString(open.to, line.to).trim() !== ''
            if (hasText) {
              // Take the separating space along so the text does not shift right.
              const gap = doc.sliceString(open.to, open.to + 1) === ' ' ? 1 : 0
              marker(open.from, open.to + gap)
              // `### title ###`: the closing sequence is a marker too.
              const close = marks.length > 1 ? marks[marks.length - 1] : undefined
              if (close) {
                let start = close.from
                while (start > open.to && doc.sliceString(start - 1, start) === ' ') start--
                marker(start, close.to)
              }
            } else {
              mark(open.from, open.to, MARKER_CLASS)
            }
          }
          return true
        }

        const setext = /^SetextHeading([12])$/.exec(name)
        if (setext) {
          // The underline is a marker line of its own; hiding it would leave
          // an empty line, so only the text lines get the heading style.
          const last = ref.node.getChild('HeaderMark')
          const lastText = last ? doc.lineAt(last.from).number - 1 : doc.lineAt(ref.to).number
          for (let n = doc.lineAt(ref.from).number; n <= lastText; n++) {
            specs.push({ kind: 'line', from: doc.line(n).from, className: `cm-live-h${setext[1]}` })
          }
          if (last) mark(last.from, last.to, MARKER_CLASS)
          return true
        }

        switch (name) {
          case 'StrongEmphasis':
          case 'Emphasis':
          case 'Strikethrough': {
            const cls = name === 'StrongEmphasis' ? 'cm-live-strong' : name === 'Emphasis' ? 'cm-live-em' : 'cm-live-strike'
            mark(ref.from, ref.to, cls)
            const markName = name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark'
            for (const child of ref.node.getChildren(markName)) marker(child.from, child.to)
            return true
          }
          case 'InlineCode': {
            mark(ref.from, ref.to, 'cm-live-code')
            for (const child of ref.node.getChildren('CodeMark')) marker(child.from, child.to)
            return true
          }
          case 'Link': {
            const marks = ref.node.getChildren('LinkMark')
            const open = marks[0]
            const close = marks[1]
            // Only the inline form `[text](url)` is rewritten. Reference and
            // shortcut forms (`[text][ref]`, `[text]`) are plain-looking
            // prose, so hiding their brackets would misrepresent the text.
            if (open && close && ref.node.getChild('URL')) {
              mark(open.to, close.from, 'cm-live-link')
              marker(open.from, open.to)
              marker(close.from, ref.to)
            }
            return false
          }
          case 'Autolink': {
            mark(ref.from, ref.to, 'cm-live-link')
            for (const child of ref.node.getChildren('LinkMark')) marker(child.from, child.to)
            return false
          }
          case 'URL': {
            // A bare URL (GFM autolink literal); URLs inside links are handled above.
            mark(ref.from, ref.to, 'cm-live-link')
            return false
          }
          // Block-level rendering (images, code blocks, ...) is out of scope
          // here, and their contents must not be decorated as inline text.
          case 'Image':
          case 'FencedCode':
          case 'CodeBlock':
          case 'HTMLBlock':
          case 'HTMLTag':
          case 'CommentBlock':
            return false
          default:
            return true
        }
      },
    })
  }
  return specs
}

const hideDecoration = Decoration.replace({})
const markCache = new Map<string, Decoration>()
const lineCache = new Map<string, Decoration>()

function markDecoration(className: string): Decoration {
  let deco = markCache.get(className)
  if (!deco) markCache.set(className, (deco = Decoration.mark({ class: className })))
  return deco
}

function lineDecoration(className: string): Decoration {
  let deco = lineCache.get(className)
  if (!deco) lineCache.set(className, (deco = Decoration.line({ class: className })))
  return deco
}

export function buildDecorations(state: EditorState, ranges: readonly TextRange[]): DecorationSet {
  const decorations: Range<Decoration>[] = collectSpecs(state, ranges).map((spec) => {
    if (spec.kind === 'line') return lineDecoration(spec.className).range(spec.from)
    if (spec.kind === 'hide') return hideDecoration.range(spec.from, spec.to)
    return markDecoration(spec.className).range(spec.from, spec.to)
  })
  // Specs arrive in tree order, which is not the start order the builder needs.
  return Decoration.set(decorations, true)
}

/** Recomputes only the visible ranges, and only when something that affects them changed. */
export const liveDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state, view.visibleRanges)
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.state, update.view.visibleRanges)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const headingSizes: Record<number, string> = { 1: '1.7em', 2: '1.45em', 3: '1.25em', 4: '1.1em', 5: '1em', 6: '0.95em' }

/** Colours come from the app palette variables, so light/dark needs no separate theme. */
export const liveTheme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'transparent', minHeight: '40vh', maxHeight: '60vh' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'auto' },
  '.cm-content': { padding: '4px 2px', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: 'color-mix(in srgb, var(--accent) 28%, transparent)',
  },
  '.cm-placeholder': { color: 'var(--text-muted)' },
  [`.${MARKER_CLASS}`]: { color: 'var(--text-muted)', fontWeight: 'normal', fontStyle: 'normal' },
  ...Object.fromEntries(
    Object.entries(headingSizes).map(([level, size]) => [
      `.cm-live-h${level}`,
      { fontSize: size, fontWeight: '700', lineHeight: '1.35' },
    ]),
  ),
  '.cm-live-strong': { fontWeight: '700' },
  '.cm-live-em': { fontStyle: 'italic' },
  '.cm-live-strike': { textDecoration: 'line-through', color: 'var(--text-muted)' },
  '.cm-live-code': {
    fontFamily: 'var(--mono)',
    fontSize: '0.92em',
    background: 'var(--surface-muted)',
    borderRadius: '4px',
    padding: '0 3px',
  },
  '.cm-live-link': { color: 'var(--accent)', textDecoration: 'underline' },
})
