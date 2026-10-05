import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, Facet, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { parseCardLine } from '../../../shared/link-card'
import type { LinkPreview } from '../../../shared/types'
import { loadLinkPreview, peekLinkPreview, proxiedImageSrc } from '../link-preview'
import { activeLineNumbers } from './active-lines'

export interface CardLine {
  from: number
  to: number
  url: string
}

/** Syntax nodes whose contents are code or raw HTML, never markdown. */
const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock'])

export function isInCode(state: EditorState, pos: number): boolean {
  return isInNode(state, pos, CODE_NODES)
}

function isInNode(state: EditorState, pos: number, names: ReadonlySet<string>): boolean {
  const tree = syntaxTree(state)
  // Check both sides so a position on a node boundary is judged by either neighbour.
  for (const side of [-1, 1] as const) {
    for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (names.has(node.name) && node.from <= pos && pos <= node.to) return true
    }
  }
  return false
}

const TABLE_NODES = new Set(['Table'])

/** Every card line in the document that is not inside code or a table. */
export function collectCardLines(state: EditorState): CardLine[] {
  const cards: CardLine[] = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    if (!line.text.startsWith('@[card](')) continue
    const url = parseCardLine(line.text)
    // GFM continues a table over a directly following line, so that line is a table row.
    if (url === null || isInCode(state, line.from) || isInNode(state, line.from, TABLE_NODES)) continue
    cards.push({ from: line.from, to: line.to, url })
  }
  return cards
}

/** Supplies the (localised) strings of the card widget, read each time a card is drawn. */
export const cardLabels = Facet.define<() => { edit: string }, () => { edit: string }>({
  combine: (values) => values[0] ?? (() => ({ edit: '' })),
})

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// The widget currently drawn in each card DOM, so a late preview is rendered with fresh state.
const drawnBy = new WeakMap<HTMLElement, LinkCardWidget>()

class LinkCardWidget extends WidgetType {
  readonly preview: LinkPreview | undefined

  constructor(
    readonly url: string,
    readonly readOnly: boolean,
    readonly editLabel: string,
  ) {
    super()
    this.preview = peekLinkPreview(url)
  }

  eq(other: LinkCardWidget): boolean {
    return (
      other.url === this.url &&
      other.readOnly === this.readOnly &&
      other.editLabel === this.editLabel &&
      other.preview === this.preview
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-live-card'
    dom.dataset.url = this.url
    dom.title = this.url
    // Keep the editor's focus without moving the caret; the click alone opens the link.
    dom.addEventListener('mousedown', (event) => event.preventDefault())
    dom.addEventListener('click', (event) => {
      // A double-click would otherwise open two tabs.
      if (event.detail > 1) return
      window.open(this.url, '_blank', 'noopener,noreferrer')
    })
    drawnBy.set(dom, this)
    this.render(dom, view, this.preview)
    return dom
  }

  // A different url needs fresh handlers, so only the same card is updated in place.
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (dom.dataset.url !== this.url) return false
    drawnBy.set(dom, this)
    this.render(dom, view, this.preview)
    return true
  }

  // Cards handle their own clicks; the editor must not move the caret on them.
  ignoreEvent(): boolean {
    return true
  }

  render(dom: HTMLElement, view: EditorView, preview: LinkPreview | undefined): void {
    const children: HTMLElement[] = []
    const measureOnSettle = (img: HTMLImageElement, removeOnError: boolean): void => {
      img.addEventListener('load', () => view.requestMeasure())
      img.addEventListener('error', () => {
        if (removeOnError) img.remove()
        view.requestMeasure()
      })
    }

    if (preview?.image) {
      const thumb = document.createElement('img')
      thumb.className = 'cm-live-card-thumb'
      thumb.alt = ''
      thumb.loading = 'lazy'
      thumb.src = proxiedImageSrc(preview.image)
      measureOnSettle(thumb, true)
      children.push(thumb)
    }

    const body = document.createElement('div')
    body.className = 'cm-live-card-body'
    // textContent only: titles and descriptions come from untrusted pages.
    const title = document.createElement('div')
    title.className = 'cm-live-card-title'
    title.textContent = preview?.title || preview?.siteName || hostnameOf(this.url)
    body.append(title)
    if (preview?.description) {
      const desc = document.createElement('div')
      desc.className = 'cm-live-card-desc'
      desc.textContent = preview.description
      body.append(desc)
    }
    const urlRow = document.createElement('div')
    urlRow.className = 'cm-live-card-url'
    if (preview?.favicon) {
      const favicon = document.createElement('img')
      favicon.className = 'cm-live-card-favicon'
      favicon.alt = ''
      favicon.src = proxiedImageSrc(preview.favicon)
      measureOnSettle(favicon, true)
      urlRow.append(favicon)
    }
    const urlText = document.createElement('span')
    urlText.textContent = this.url
    urlRow.append(urlText)
    body.append(urlRow)
    children.push(body)

    if (!this.readOnly) {
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.className = 'cm-live-card-edit'
      edit.textContent = '\u270e'
      edit.setAttribute('aria-label', this.editLabel)
      edit.title = this.editLabel
      // mousedown only, so the editor keeps focus until the click lands.
      edit.addEventListener('mousedown', (event) => event.preventDefault())
      edit.addEventListener('click', (event) => {
        event.stopPropagation()
        const from = view.posAtDOM(dom)
        view.dispatch({ selection: { anchor: view.state.doc.lineAt(from).to } })
        view.focus()
      })
      children.push(edit)
    }
    dom.replaceChildren(...children)

    if (!preview) {
      // Fill the existing DOM in place; a rejection leaves the placeholder.
      loadLinkPreview(this.url).then(
        (loaded) => {
          if (!dom.isConnected || dom.dataset.url !== this.url) return
          (drawnBy.get(dom) ?? this).render(dom, view, loaded)
          view.requestMeasure()
        },
        () => {},
      )
    }
  }
}

function sameCards(a: readonly CardLine[], b: readonly CardLine[]): boolean {
  return (
    a.length === b.length &&
    a.every((card, i) => {
      const other = b[i]
      return other !== undefined && card.from === other.from && card.to === other.to && card.url === other.url
    })
  )
}

interface CardFieldValue {
  cards: CardLine[]
  decorations: DecorationSet
}

// A card is shown only while the caret is off its line, so the source is editable.
function buildCardDecorations(state: EditorState, cards: readonly CardLine[]): DecorationSet {
  const active = activeLineNumbers(state)
  const { edit } = state.facet(cardLabels)()
  const ranges: Range<Decoration>[] = []
  for (const card of cards) {
    if (active.has(state.doc.lineAt(card.from).number)) continue
    ranges.push(
      Decoration.replace({ widget: new LinkCardWidget(card.url, state.readOnly, edit), block: true }).range(
        card.from,
        card.to,
      ),
    )
  }
  return Decoration.set(ranges)
}

// Block widgets must come from a StateField (see blocks.ts).
export const cardField = StateField.define<CardFieldValue>({
  create(state) {
    const cards = collectCardLines(state)
    return { cards, decorations: buildCardDecorations(state, cards) }
  },
  update(value, tr) {
    const rescan = tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)
    const found = rescan ? collectCardLines(tr.state) : value.cards
    const cards = sameCards(found, value.cards) ? value.cards : found
    if (cards === value.cards && !tr.selection && tr.startState.readOnly === tr.state.readOnly) return value
    return { cards, decorations: buildCardDecorations(tr.state, cards) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

export const linkCards: Extension = [cardField]

export const cardTheme = EditorView.theme({
  '.cm-live-card': {
    display: 'flex',
    position: 'relative',
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '100%',
    // Nowrap titles and URLs must not widen the editor's min-content size.
    contain: 'inline-size',
    height: '120px',
    margin: '4px 0',
    lineHeight: '1.4',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    overflow: 'hidden',
    cursor: 'pointer',
    background: 'var(--surface)',
  },
  '.cm-live-card:hover': { background: 'var(--surface-muted)' },
  '.cm-live-card-thumb': { flex: 'none', width: '32%', maxWidth: '220px', objectFit: 'cover' },
  '.cm-live-card-body': {
    display: 'flex',
    flexDirection: 'column',
    flex: '1',
    minWidth: '0',
    // Right padding keeps the text clear of the edit button.
    padding: '10px 42px 10px 14px',
  },
  '.cm-live-card-title': {
    fontWeight: '600',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-live-card-desc': {
    marginTop: '2px',
    fontSize: '0.85em',
    color: 'var(--text-muted)',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    overflow: 'hidden',
  },
  '.cm-live-card-url': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: 'auto',
    fontSize: '0.8em',
    color: 'var(--text-muted)',
    minWidth: '0',
  },
  '.cm-live-card-url span': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-live-card-favicon': { width: '16px', height: '16px', flex: 'none' },
  '.cm-live-card-edit': {
    position: 'absolute',
    top: '6px',
    right: '6px',
    width: '28px',
    height: '28px',
    minWidth: '0',
    minHeight: '0',
    padding: '0',
    lineHeight: '1',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    background: 'var(--surface)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
  '.cm-live-card-edit:hover': { color: 'var(--text)', background: 'var(--surface-muted)' },
  '@media (max-width: 720px)': {
    '.cm-live-card-thumb': { width: '88px' },
    '.cm-live-card-desc': { WebkitLineClamp: '1' },
  },
})
