import { type EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { activeLineNumbers } from './active-lines'

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/

function parses(text: string): URL | null {
  try {
    return new URL(text)
  } catch {
    return null
  }
}

/**
 * The href for a link target as written in markdown, or null when it must stay
 * a plain styled span (relative paths, javascript:, data:, ftp:, ...).
 */
export function linkHref(raw: string): string | null {
  let text = raw.trim()
  // Lezer keeps the angle brackets of `[a](<b c>)` in the URL node.
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1).trim()
  if (text === '') return null

  if (SCHEME.test(text)) {
    const url = parses(text)
    return url && ALLOWED_PROTOCOLS.has(url.protocol) ? text : null
  }
  // GFM autolink literal without a scheme.
  if (text.toLowerCase().startsWith('www.')) {
    const href = `http://${text}`
    return parses(href) ? href : null
  }
  if (EMAIL.test(text)) return `mailto:${text}`
  return null
}

/** What a primary click on a link at `pos` does: open in a new tab, or just place the caret. */
export function linkClickAction(state: EditorState, pos: number): 'open' | 'caret' {
  if (state.readOnly) return 'open'
  // Off the caret line the markup is hidden, so the link reads as a plain link.
  return activeLineNumbers(state).has(state.doc.lineAt(pos).number) ? 'caret' : 'open'
}

interface PendingClick {
  anchor: HTMLAnchorElement
  open: boolean
}

function anchorAt(view: EditorView, target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest<HTMLAnchorElement>('a.cm-live-link[href]')
  return anchor && view.contentDOM.contains(anchor) ? anchor : null
}

const isInside = (pending: PendingClick | null, target: EventTarget | null): pending is PendingClick =>
  pending !== null && target instanceof Node && pending.anchor.contains(target)

/**
 * Decides on pointerdown, before CodeMirror moves the caret and reveals the
 * markup, whether the gesture is a link activation. The later mousedown/click
 * only act on that snapshot.
 */
export const linkClicks: Extension = ViewPlugin.fromClass(
  class {
    pending: PendingClick | null = null
  },
  {
    eventHandlers: {
      pointerdown(event: PointerEvent, view: EditorView) {
        const anchor = event.button === 0 ? anchorAt(view, event.target) : null
        if (!anchor) {
          this.pending = null
          return false
        }
        const modifier = event.ctrlKey || event.metaKey
        this.pending = { anchor, open: modifier || linkClickAction(view.state, view.posAtDOM(anchor)) === 'open' }
        return false
      },
      mousedown(event: MouseEvent) {
        if (!this.pending?.open || !isInside(this.pending, event.target)) return false
        // Stops CodeMirror from placing the caret, which would reveal the markup.
        event.preventDefault()
        return true
      },
      click(event: MouseEvent, view: EditorView) {
        const { pending } = this
        this.pending = null
        // CodeMirror may redraw the line between pointerdown and click, which
        // replaces the anchor; fall back to comparing hrefs.
        if (!pending) return false
        const sameHref = anchorAt(view, event.target)?.href === pending.anchor.href
        if (!sameHref && !isInside(pending, event.target)) return false
        // Read-only content is not contenteditable, so the native anchor would navigate too.
        event.preventDefault()
        if (!pending.open) return false
        // The second click of a double-click must not open another tab.
        if (event.detail > 1) return true
        window.open(pending.anchor.href, '_blank', 'noopener,noreferrer')
        return true
      },
    },
  },
)
