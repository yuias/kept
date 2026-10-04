import {
  type EditorState,
  type Extension,
  Facet,
  Prec,
  StateEffect,
  StateField,
  type TransactionSpec,
} from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import { cardMarkup } from '../../../shared/link-card'
import { isInCode } from './link-cards'

export interface PendingCard {
  from: number
  to: number
  url: string
}

const URL_TEXT = /^https?:\/\/\S+$/

function isParsableUrl(text: string): boolean {
  try {
    new URL(text)
    return true
  } catch {
    return false
  }
}

/**
 * The edit for pasting `text` as a lone URL, or null to let CodeMirror paste
 * normally. The whole (whitespace-only) line is replaced so card syntax can
 * later start at column 0. Returned positions are in the pre-paste document.
 */
export function detectUrlPaste(state: EditorState, text: string): PendingCard | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const caret = state.selection.main
  if (!caret.empty) return null
  const url = text.trim()
  if (!URL_TEXT.test(url) || !isParsableUrl(url)) return null
  const line = state.doc.lineAt(caret.head)
  if (line.text.trim() !== '' || isInCode(state, caret.head)) return null
  return { from: line.from, to: line.to, url }
}

/**
 * The transaction for choosing Card. `pending` holds positions in the current
 * document. The caret moves to the line after the card so it renders at once.
 */
export function cardChoice(state: EditorState, pending: PendingCard): TransactionSpec {
  const markup = cardMarkup(pending.url)
  const line = state.doc.lineAt(pending.to)
  const nextIsEmpty = line.number < state.doc.lines && state.doc.line(line.number + 1).length === 0
  return {
    changes: { from: pending.from, to: pending.to, insert: nextIsEmpty ? markup : `${markup}\n` },
    selection: { anchor: pending.from + markup.length + 1 },
    effects: setPending.of(null),
    // Without a user event, history would merge this into the paste when
    // clicked quickly, and one undo would skip the plain-URL state.
    userEvent: 'input',
    scrollIntoView: true,
  }
}

export const setPending = StateEffect.define<PendingCard | null>()

export const pendingField = StateField.define<PendingCard | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPending)) return effect.value
    }
    return tr.docChanged || tr.selection ? null : value
  },
})

/** Supplies the (localised) strings of the paste popup, read each time it opens. */
export const pasteLabels = Facet.define<
  () => { link: string; card: string; group: string },
  () => { link: string; card: string; group: string }
>({
  combine: (values) => values[0] ?? (() => ({ link: '', card: '', group: '' })),
})

function choiceButton(label: string, onChoose: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  // mousedown only, so the editor keeps focus until the click lands.
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', onChoose)
  return button
}

const pasteTooltip = showTooltip.compute([pendingField], (state): Tooltip | null => {
  const pending = state.field(pendingField)
  if (!pending) return null
  return {
    pos: pending.to,
    above: false,
    create(view) {
      const labels = view.state.facet(pasteLabels)()
      const dom = document.createElement('div')
      dom.className = 'cm-live-paste-choice'
      dom.setAttribute('role', 'group')
      dom.setAttribute('aria-label', labels.group)
      const current = (): PendingCard | null => view.state.field(pendingField)
      dom.append(
        choiceButton(labels.link, () => view.dispatch({ effects: setPending.of(null) })),
        choiceButton(labels.card, () => {
          const choice = current()
          if (choice) view.dispatch(cardChoice(view.state, choice))
        }),
      )
      return { dom }
    },
  }
})

const pasteHandler = EditorView.domEventHandlers({
  paste: (event, view) => {
    // An image paste is already handled by the note editor.
    if (event.defaultPrevented) return false
    const text = event.clipboardData?.getData('text/plain')
    if (!text) return false
    const hit = detectUrlPaste(view.state, text)
    if (!hit) return false
    event.preventDefault()
    view.dispatch({
      changes: { from: hit.from, to: hit.to, insert: hit.url },
      selection: { anchor: hit.from + hit.url.length },
      userEvent: 'input.paste',
      scrollIntoView: true,
      effects: setPending.of({ from: hit.from, to: hit.from + hit.url.length, url: hit.url }),
    })
    return true
  },
})

// Handled keydown is also prevented, so Esc does not close the note dialog.
const escapeKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Escape',
      run(view) {
        if (!view.state.field(pendingField)) return false
        view.dispatch({ effects: setPending.of(null) })
        return true
      },
    },
  ]),
)

const pasteTheme = EditorView.theme({
  '.cm-tooltip.cm-live-paste-choice': {
    display: 'flex',
    gap: '2px',
    padding: '3px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    background: 'var(--surface)',
    boxShadow: '0 2px 8px rgb(0 0 0 / 0.15)',
  },
  '.cm-live-paste-choice button': {
    minWidth: '0',
    minHeight: '0',
    padding: '4px 10px',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: '0.9em',
    cursor: 'pointer',
  },
  '.cm-live-paste-choice button:hover': { background: 'var(--surface-muted)' },
})

export const linkPaste: Extension = [
  pendingField,
  pasteTooltip,
  pasteHandler,
  escapeKeymap,
  EditorView.focusChangeEffect.of((state, focusing) =>
    focusing || !state.field(pendingField, false) ? null : setPending.of(null),
  ),
  pasteTheme,
]
