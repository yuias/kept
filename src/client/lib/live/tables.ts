import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { activeLineNumbers } from './active-lines'
import {
  type Align,
  collectTables,
  type InlineSpan,
  type TableBlock,
  type TableCell,
  type TableModel,
} from './table-model'

// A table spans several lines, so it is drawn as a block replace decoration. Those must
// come from a StateField (a ViewPlugin cannot provide them), same as the link cards.
// Only top-level tables render: quoted or listed tables carry per-line prefixes that one
// widget would drop, so they stay source (see collectTables).

function renderInline(parent: ParentNode, spans: readonly InlineSpan[]): void {
  for (const span of spans) {
    switch (span.kind) {
      case 'text':
        parent.append(document.createTextNode(span.text))
        break
      case 'code': {
        const code = document.createElement('code')
        code.className = 'cm-live-code'
        code.textContent = span.text
        parent.append(code)
        break
      }
      case 'strong':
      case 'em':
      case 'strike': {
        const el = document.createElement('span')
        el.className = `cm-live-${span.kind}`
        renderInline(el, span.children)
        parent.append(el)
        break
      }
      case 'link': {
        // A disallowed target is shown as plain label text.
        if (span.href === null) {
          renderInline(parent, span.children)
          break
        }
        // Shape expected by the linkClicks plugin (a.cm-live-link[href]).
        const anchor = document.createElement('a')
        anchor.className = 'cm-live-link'
        anchor.href = span.href
        anchor.target = '_blank'
        anchor.rel = 'noopener noreferrer'
        renderInline(anchor, span.children)
        parent.append(anchor)
        break
      }
    }
  }
}

function buildCell(tag: 'th' | 'td', cell: TableCell, align: Align): HTMLElement {
  const el = document.createElement(tag)
  renderInline(el, cell)
  if (align !== null) el.style.textAlign = align
  return el
}

function buildRow(tag: 'th' | 'td', cells: readonly TableCell[], align: readonly Align[]): HTMLElement {
  const tr = document.createElement('tr')
  cells.forEach((cell, i) => tr.append(buildCell(tag, cell, align[i] ?? null)))
  return tr
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly model: TableModel,
    readonly readOnly: boolean,
  ) {
    super()
  }

  // The model is a function of the source, so the source is the identity.
  eq(other: TableWidget): boolean {
    return other.source === this.source && other.readOnly === this.readOnly
  }

  toDOM(): HTMLElement {
    const { align, header, rows } = this.model
    const wrap = document.createElement('div')
    wrap.className = 'cm-live-table'
    const table = document.createElement('table')
    const thead = document.createElement('thead')
    thead.append(buildRow('th', header, align))
    table.append(thead)
    if (rows.length > 0) {
      const tbody = document.createElement('tbody')
      for (const row of rows) tbody.append(buildRow('td', row, align))
      table.append(tbody)
    }
    wrap.append(table)
    return wrap
  }

  // Read-only: the editor must not move the caret here, which would flip the table to
  // source; anchors then navigate natively. Editable: clicks reach the editor so a click
  // reveals the source, and anchors are handled by linkClicks.
  ignoreEvent(): boolean {
    return this.readOnly
  }
}

function sameTables(a: readonly TableBlock[], b: readonly TableBlock[]): boolean {
  return (
    a.length === b.length &&
    a.every((table, i) => {
      const other = b[i]
      return other !== undefined && table.from === other.from && table.to === other.to && table.source === other.source
    })
  )
}

interface TableFieldValue {
  tables: TableBlock[]
  decorations: DecorationSet
}

// A table is shown only while no selection range touches its lines, so the source stays editable.
function buildTableDecorations(state: EditorState, tables: readonly TableBlock[]): DecorationSet {
  const active = activeLineNumbers(state)
  const ranges: Range<Decoration>[] = []
  for (const table of tables) {
    const first = state.doc.lineAt(table.from).number
    const last = state.doc.lineAt(table.to).number
    let touched = false
    for (let n = first; n <= last && !touched; n++) touched = active.has(n)
    if (touched) continue
    ranges.push(
      Decoration.replace({ widget: new TableWidget(table.source, table.model, state.readOnly), block: true }).range(
        table.from,
        table.to,
      ),
    )
  }
  return Decoration.set(ranges)
}

export const tableField = StateField.define<TableFieldValue>({
  create(state) {
    const tables = collectTables(state)
    return { tables, decorations: buildTableDecorations(state, tables) }
  },
  update(value, tr) {
    const rescan = tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)
    const found = rescan ? collectTables(tr.state) : value.tables
    const tables = sameTables(found, value.tables) ? value.tables : found
    if (tables === value.tables && !tr.selection && tr.startState.readOnly === tr.state.readOnly) return value
    return { tables, decorations: buildTableDecorations(tr.state, tables) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

export const liveTables: Extension = [tableField]

export const tableTheme: Extension = EditorView.theme({
  '.cm-live-table': {
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '100%',
    // The table's min-content width must not widen the editor.
    contain: 'inline-size',
    overflowX: 'auto',
    margin: '4px 0',
    // Undo the inherited lineWrapping rules, which would squeeze columns to one character.
    whiteSpace: 'normal',
    overflowWrap: 'normal',
    wordBreak: 'normal',
    lineHeight: '1.5',
  },
  '.cm-live-table table': { borderCollapse: 'collapse', width: 'auto' },
  '.cm-live-table th, .cm-live-table td': {
    border: '1px solid var(--border)',
    padding: '4px 10px',
    verticalAlign: 'top',
  },
  '.cm-live-table th': { background: 'var(--surface-muted)', fontWeight: '600' },
  '.cm-live-table tbody tr:nth-child(even) td': { background: 'var(--surface)' },
  '@media (max-width: 720px)': {
    '.cm-live-table': { fontSize: '0.9em' },
    '.cm-live-table th, .cm-live-table td': { padding: '3px 6px' },
  },
})
