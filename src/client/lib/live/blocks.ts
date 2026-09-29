/**
 * Block-level live-preview: images, rules, task checkboxes, quotes, lists and
 * code blocks. Like the inline decorations this is view state only; the one
 * document edit here is a checkbox click, which changes exactly the `[ ]` /
 * `[x]` character.
 *
 * Everything that stays within one line comes from a ViewPlugin over the
 * visible ranges, so cost follows the viewport rather than the note size.
 * Only the image preview under an edited line is a block widget, which a
 * ViewPlugin may not provide, so it lives in a StateField that looks at the
 * selected lines alone.
 */
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, Facet, type Range, StateField, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { activeLineNumbers, MARKER_CLASS } from './decorations'

export type BlockSpec =
  | { kind: 'line'; from: number; className: string }
  | { kind: 'mark'; from: number; to: number; className: string }
  | { kind: 'hide'; from: number; to: number }
  | { kind: 'checkbox'; from: number; to: number; checked: boolean }
  | { kind: 'rule'; from: number; to: number }
  // Replaces the markdown source (always within one line) with the image.
  | { kind: 'image'; from: number; to: number; src: string; alt: string }

/** Shows the image below a line whose source is being edited. */
export interface PreviewSpec {
  at: number
  src: string
  alt: string
}

interface TextRange {
  from: number
  to: number
}

export interface TextEdit {
  from: number
  to: number
  insert: string
}

// Only images this app serves. Anything else stays as source text so the
// editor never fetches arbitrary external URLs (tracking, mixed content).
const LOCAL_IMAGE = /^\/img\/[\w-]+$/

/** The URL to load for an image target, or null when it must not be rendered. */
export function localImageSrc(url: string): string | null {
  return LOCAL_IMAGE.test(url) ? url : null
}

/** The edit that flips a `[ ]` / `[x]` marker starting at `from`, or null if `marker` is not one. */
export function taskToggleChange(marker: string, from: number): TextEdit | null {
  if (!/^\[[ xX]\]$/.test(marker)) return null
  return { from: from + 1, to: from + 2, insert: marker[1] === ' ' ? 'x' : ' ' }
}

export function isBulletMark(mark: string): boolean {
  return mark === '-' || mark === '*' || mark === '+'
}

interface ImageNode {
  from: number
  to: number
  getChild(name: string): { from: number; to: number } | null
  getChildren(name: string): { from: number; to: number }[]
}

/** The renderable target and alt text of an Image node, or null when it stays source text. */
function readImage(node: ImageNode, doc: Text): { src: string; alt: string } | null {
  const url = node.getChild('URL')
  const [open, close] = node.getChildren('LinkMark')
  if (!url || !open || !close) return null
  const src = localImageSrc(doc.sliceString(url.from, url.to))
  return src ? { src, alt: doc.sliceString(open.to, close.from) } : null
}

/**
 * Maps the syntax tree over `ranges` to single-line decoration specs. Only
 * specs that start inside a range are returned, and repeats (from overlapping
 * ranges) are dropped. Separate from the `Decoration` objects so the rules can
 * be tested without a DOM.
 */
export function collectBlockSpecs(state: EditorState, ranges: readonly TextRange[]): BlockSpec[] {
  const { doc } = state
  const active = activeLineNumbers(state)
  const specs: BlockSpec[] = []
  const seen = new Set<string>()
  let lo = 0
  let hi = 0

  const emit = (spec: BlockSpec): void => {
    if (spec.from < lo || spec.from > hi) return
    const key = `${spec.kind}:${spec.from}:${'to' in spec ? spec.to : ''}:${'className' in spec ? spec.className : ''}`
    if (seen.has(key)) return
    seen.add(key)
    specs.push(spec)
  }
  // Lines of a node, limited to the current range so a huge quote or code
  // block costs only its visible part. A node that ends right after a line
  // break does not own the next line.
  const linesOf = (from: number, to: number, className: (n: number, first: number, last: number) => string): void => {
    const end = to > from && doc.lineAt(to).from === to ? to - 1 : to
    const first = doc.lineAt(from).number
    const last = doc.lineAt(end).number
    const start = Math.max(first, doc.lineAt(Math.max(from, lo)).number)
    const stop = Math.min(last, doc.lineAt(Math.min(end, hi)).number)
    for (let n = start; n <= stop; n++) emit({ kind: 'line', from: doc.line(n).from, className: className(n, first, last) })
  }
  const lineActive = (pos: number): boolean => active.has(doc.lineAt(pos).number)
  const sameLine = (from: number, to: number): boolean => doc.lineAt(from).number === doc.lineAt(to).number
  const quoteMark = (from: number, to: number): void => {
    const gap = doc.sliceString(to, to + 1) === ' ' ? 1 : 0
    if (lineActive(from)) emit({ kind: 'mark', from, to, className: MARKER_CLASS })
    else emit({ kind: 'hide', from, to: to + gap })
  }

  for (const range of ranges) {
    lo = range.from
    hi = range.to
    syntaxTree(state).iterate({
      from: lo,
      to: hi,
      enter: (ref) => {
        switch (ref.name) {
          case 'Image': {
            // A replace may not cross a line break; multi-line images and
            // those on an edited line stay source (the latter get a preview).
            const image = readImage(ref.node, doc)
            if (image && sameLine(ref.from, ref.to) && !lineActive(ref.from)) {
              emit({ kind: 'image', from: ref.from, to: ref.to, ...image })
            }
            return false
          }
          case 'HorizontalRule': {
            if (lineActive(ref.from) || !sameLine(ref.from, ref.to)) {
              emit({ kind: 'mark', from: ref.from, to: ref.to, className: MARKER_CLASS })
            } else emit({ kind: 'rule', from: ref.from, to: ref.to })
            return false
          }
          case 'Blockquote': {
            let depth = 0
            for (let p: typeof ref.node | null = ref.node; p; p = p.parent) if (p.name === 'Blockquote') depth++
            linesOf(ref.from, ref.to, () => 'cm-live-quote')
            if (depth > 1) linesOf(ref.from, ref.to, () => 'cm-live-quote-nest')
            return true
          }
          case 'QuoteMark':
            quoteMark(ref.from, ref.to)
            return false
          case 'ListItem': {
            const mark = ref.node.getChild('ListMark')
            const taskMarker = ref.node.getChild('Task')?.getChild('TaskMarker')
            if (!mark) return true
            // A checkbox stands in for the bullet, so the bullet goes when it shows.
            if (
              taskMarker &&
              isBulletMark(doc.sliceString(mark.from, mark.to)) &&
              !lineActive(mark.from) &&
              sameLine(mark.from, taskMarker.from)
            ) {
              emit({ kind: 'hide', from: mark.from, to: taskMarker.from })
            } else emit({ kind: 'mark', from: mark.from, to: mark.to, className: 'cm-live-list-mark' })
            return true
          }
          case 'TaskMarker': {
            const text = doc.sliceString(ref.from, ref.to)
            if (!taskToggleChange(text, ref.from)) return false
            if (lineActive(ref.from)) emit({ kind: 'mark', from: ref.from, to: ref.to, className: MARKER_CLASS })
            else emit({ kind: 'checkbox', from: ref.from, to: ref.to, checked: text[1] !== ' ' })
            return false
          }
          case 'FencedCode':
          case 'CodeBlock': {
            linesOf(ref.from, ref.to, (n, first, last) => {
              const cls = ['cm-live-codeblock']
              if (n === first) cls.push('cm-live-codeblock-first')
              if (n === last) cls.push('cm-live-codeblock-last')
              return cls.join(' ')
            })
            for (const child of [...ref.node.getChildren('CodeMark'), ...ref.node.getChildren('CodeInfo')]) {
              emit({ kind: 'mark', from: child.from, to: child.to, className: MARKER_CLASS })
            }
            // The parser nests the `>` of a quoted code block inside the block.
            for (const child of ref.node.getChildren('QuoteMark')) quoteMark(child.from, child.to)
            return false
          }
          default:
            return true
        }
      },
    })
  }
  return specs
}

/** Above this many selected lines the previews are skipped, so select-all stays cheap. */
const PREVIEW_MAX_LINES = 200

/** Renderable images that touch a selected line, walking only those lines. */
export function collectPreviewSpecs(state: EditorState): PreviewSpec[] {
  const { doc } = state
  const specs: PreviewSpec[] = []
  const seen = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from)
    const last = doc.lineAt(range.to)
    if (last.number - first.number >= PREVIEW_MAX_LINES) continue
    syntaxTree(state).iterate({
      from: first.from,
      to: last.to,
      enter: (ref) => {
        if (ref.name !== 'Image') return true
        if (seen.has(ref.from)) return false
        seen.add(ref.from)
        const image = readImage(ref.node, doc)
        if (image) specs.push({ at: doc.lineAt(ref.to).to, ...image })
        return false
      },
    })
  }
  return specs
}

/** Supplies the (localised) accessible name of a task checkbox, read each time one is drawn. */
export const taskLabel = Facet.define<() => string, () => string>({
  combine: (values) => values[0] ?? (() => ''),
})

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly readOnly: boolean,
    readonly label: string,
  ) {
    super()
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.readOnly === this.readOnly && other.label === this.label
  }

  updateDOM(dom: HTMLElement): boolean {
    const input = dom as HTMLInputElement
    input.checked = this.checked
    input.disabled = this.readOnly
    input.setAttribute('aria-label', this.label)
    return true
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'cm-live-checkbox'
    input.checked = this.checked
    input.disabled = this.readOnly
    input.setAttribute('aria-label', this.label)
    // Keep the editor's focus and caret; the click alone toggles.
    input.addEventListener('mousedown', (event) => event.preventDefault())
    input.addEventListener('click', (event) => {
      // The document is the source of truth; the widget is redrawn from it.
      event.preventDefault()
      if (view.state.readOnly) return
      const from = view.posAtDOM(input)
      const change = taskToggleChange(view.state.sliceDoc(from, from + 3), from)
      if (change) view.dispatch({ changes: change, userEvent: 'input.toggle' })
    })
    return input
  }

  // The checkbox handles its own events; the editor must not react to them.
  ignoreEvent(): boolean {
    return true
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly preview: boolean,
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.preview === this.preview
  }

  // Editing the alt text keeps the loaded <img> instead of recreating it.
  updateDOM(dom: HTMLElement): boolean {
    const img = dom as HTMLImageElement
    if (img.classList.contains('cm-live-image-preview') !== this.preview) return false
    if (img.getAttribute('src') !== this.src) img.src = this.src
    img.alt = this.alt
    return true
  }

  toDOM(view: EditorView): HTMLElement {
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.draggable = false
    img.className = this.preview ? 'cm-live-image cm-live-image-preview' : 'cm-live-image'
    // Loading changes line heights, which the editor has to re-measure.
    img.addEventListener('load', () => view.requestMeasure())
    img.addEventListener('error', () => view.requestMeasure())
    return img
  }

  // Let clicks reach the editor so they move the caret and reveal the source.
  ignoreEvent(): boolean {
    return false
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-live-rule'
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

const hideDecoration = Decoration.replace({})
const ruleDecoration = Decoration.replace({ widget: new RuleWidget() })
const markCache = new Map<string, Decoration>()
const lineCache = new Map<string, Decoration>()

function cached(cache: Map<string, Decoration>, className: string, make: () => Decoration): Decoration {
  let deco = cache.get(className)
  if (!deco) cache.set(className, (deco = make()))
  return deco
}

export function buildBlockDecorations(state: EditorState, ranges: readonly TextRange[]): DecorationSet {
  const label = state.facet(taskLabel)()
  const decorations: Range<Decoration>[] = collectBlockSpecs(state, ranges).map((spec) => {
    switch (spec.kind) {
      case 'line':
        return cached(lineCache, spec.className, () => Decoration.line({ class: spec.className })).range(spec.from)
      case 'mark':
        return cached(markCache, spec.className, () => Decoration.mark({ class: spec.className })).range(
          spec.from,
          spec.to,
        )
      case 'hide':
        return hideDecoration.range(spec.from, spec.to)
      case 'rule':
        return ruleDecoration.range(spec.from, spec.to)
      case 'checkbox':
        return Decoration.replace({ widget: new CheckboxWidget(spec.checked, state.readOnly, label) }).range(
          spec.from,
          spec.to,
        )
      case 'image':
        return Decoration.replace({ widget: new ImageWidget(spec.src, spec.alt, false) }).range(spec.from, spec.to)
    }
  })
  // Specs arrive in tree order, which is not the start order the builder needs.
  return Decoration.set(decorations, true)
}

export function buildPreviewDecorations(state: EditorState): DecorationSet {
  return Decoration.set(
    collectPreviewSpecs(state).map((spec) =>
      Decoration.widget({ widget: new ImageWidget(spec.src, spec.alt, true), block: true, side: 1 }).range(spec.at),
    ),
    true,
  )
}

const blockPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildBlockDecorations(view.state, view.visibleRanges)
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.startState.readOnly !== update.state.readOnly ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildBlockDecorations(update.state, update.view.visibleRanges)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const previewField = StateField.define<DecorationSet>({
  create: (state) => buildPreviewDecorations(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return buildPreviewDecorations(tr.state)
    }
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

export const liveBlocks: Extension = [blockPlugin, previewField]

export const blocksTheme = EditorView.theme({
  '.cm-line.cm-live-quote': {
    borderLeft: '3px solid var(--border)',
    paddingLeft: '0.8em',
    color: 'var(--text-muted)',
  },
  '.cm-line.cm-live-quote.cm-live-quote-nest': { paddingLeft: '1.8em' },
  '.cm-line.cm-live-codeblock': {
    fontFamily: 'var(--mono)',
    fontSize: '0.92em',
    background: 'var(--surface-muted)',
    padding: '0 10px',
  },
  '.cm-line.cm-live-codeblock-first': { borderTopLeftRadius: '6px', borderTopRightRadius: '6px', paddingTop: '4px' },
  '.cm-line.cm-live-codeblock-last': {
    borderBottomLeftRadius: '6px',
    borderBottomRightRadius: '6px',
    paddingBottom: '4px',
  },
  '.cm-live-list-mark': { color: 'var(--accent)', fontWeight: '600' },
  '.cm-live-checkbox': {
    margin: '0 0.45em 0 0',
    verticalAlign: 'middle',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  },
  '.cm-live-checkbox:disabled': { cursor: 'default' },
  '.cm-live-image': {
    maxWidth: '100%',
    maxHeight: '50vh',
    borderRadius: '6px',
    verticalAlign: 'middle',
  },
  '.cm-live-image-preview': { display: 'block', margin: '4px 0' },
  '.cm-live-rule': {
    display: 'block',
    height: '1px',
    margin: '0.7em 0',
    background: 'var(--border)',
  },
})
