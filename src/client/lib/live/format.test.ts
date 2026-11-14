import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport, syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type Extension, type SelectionRange, type Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { type InlineFormat, toggleInlineFormat } from './format'

// `|` is a cursor, `«…»` a selection (anchor at «, head at »), `»…«` a reversed one.
function parse(marked: string, extensions: Extension[] = []): EditorState {
  let doc = ''
  let anchor = -1
  let head = -1
  const ranges: SelectionRange[] = []
  for (const ch of marked) {
    if (ch === '|') ranges.push(EditorSelection.cursor(doc.length))
    else if (ch === '«') anchor = doc.length
    else if (ch === '»') head = doc.length
    else {
      doc += ch
      continue
    }
    if (anchor >= 0 && head >= 0) {
      ranges.push(EditorSelection.range(anchor, head))
      anchor = -1
      head = -1
    }
  }
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.length > 0 ? ranges : [EditorSelection.cursor(0)]),
    extensions: [
      new LanguageSupport(markdownLanguage),
      EditorState.allowMultipleSelections.of(true),
      ...extensions,
    ],
  })
}

function render(state: EditorState): string {
  const inserts: { pos: number; text: string }[] = []
  for (const range of state.selection.ranges) {
    if (range.empty) inserts.push({ pos: range.from, text: '|' })
    else {
      const reversed = range.anchor > range.head
      inserts.push({ pos: range.from, text: reversed ? '»' : '«' }, { pos: range.to, text: reversed ? '«' : '»' })
    }
  }
  const doc = state.doc.toString()
  let out = ''
  let last = 0
  for (const { pos, text } of inserts) {
    out += doc.slice(last, pos) + text
    last = pos
  }
  return out + doc.slice(last)
}

function run(format: InlineFormat, marked: string): string {
  const state = parse(marked)
  let next = state
  toggleInlineFormat(format)({ state, dispatch: (tr) => (next = tr.state) })
  return render(next)
}

describe('syntax tree shapes used for removal', () => {
  const marks = (doc: string, node: string, mark: string): string[][] => {
    const found: string[][] = []
    syntaxTree(parse(doc)).iterate({
      enter: (ref) => {
        if (ref.name === node) found.push(ref.node.getChildren(mark).map((m) => doc.slice(m.from, m.to)))
      },
    })
    return found
  }

  it('nests ***foo*** as one strong and one emphasis, each with its own marks', () => {
    expect(marks('***foo***', 'StrongEmphasis', 'EmphasisMark')).toEqual([['**', '**']])
    expect(marks('***foo***', 'Emphasis', 'EmphasisMark')).toEqual([['*', '*']])
  })

  it('exposes the underscore forms as emphasis marks', () => {
    expect(marks('__b__', 'StrongEmphasis', 'EmphasisMark')).toEqual([['__', '__']])
  })

  it('exposes a double-backtick span with its two-character marks', () => {
    expect(marks('``a`b``', 'InlineCode', 'CodeMark')).toEqual([['``', '``']])
  })
})

describe('toggleInlineFormat: wrap a selection', () => {
  it('wraps a forward selection', () => {
    expect(run('strong', 'a «bold» c')).toBe('a **«bold»** c')
  })

  it('keeps a reversed selection reversed', () => {
    expect(run('strong', 'a »bold« c')).toBe('a **»bold«** c')
  })

  it('wraps only the trimmed text', () => {
    expect(run('strong', 'a « bold » c')).toBe('a  **«bold»**  c')
  })

  it('leaves a whitespace-only selection unchanged', () => {
    expect(run('strong', 'a« »b')).toBe('a« »b')
  })

  it('uses the marker of each format', () => {
    expect(run('emphasis', 'a «b» c')).toBe('a *«b»* c')
    expect(run('code', 'a «b» c')).toBe('a `«b»` c')
    expect(run('strike', 'a «b» c')).toBe('a ~~«b»~~ c')
  })

  it('wraps every range', () => {
    expect(run('strong', '«a» «b»')).toBe('**«a»** **«b»**')
  })

  it('leaves an empty range outside an element unchanged', () => {
    expect(run('strong', 'a| b')).toBe('a| b')
  })
})

describe('toggleInlineFormat: remove from an existing element', () => {
  it.each<[InlineFormat, string, string]>([
    ['strong', '**bo|ld**', 'bo|ld'],
    ['strong', '**bold**|', 'bold|'],
    ['strong', '|**bold**', '|bold'],
    ['strong', '«**bold**»', '«bold»'],
    ['strong', '**b«ol»d**', 'b«ol»d'],
    ['strong', '__b|__', 'b|'],
    ['emphasis', '_e|m_', 'e|m'],
    ['code', '`c|ode`', 'c|ode'],
    ['code', '``a|`b``', 'a|`b'],
    ['strike', '~~s|~~', 's|'],
    ['strong', '***fo|o***', '*fo|o*'],
    ['emphasis', '***fo|o***', '**fo|o**'],
  ])('%s: %s -> %s', (format, before, after) => {
    expect(run(format, before)).toBe(after)
  })
})

describe('toggleInlineFormat: command contract', () => {
  it('returns false and dispatches nothing when read-only', () => {
    const state = parse('a «b» c', [EditorState.readOnly.of(true)])
    let calls = 0
    const handled = toggleInlineFormat('strong')({ state, dispatch: () => calls++ })
    expect(handled).toBe(false)
    expect(calls).toBe(0)
  })

  it('dispatches a transaction with the format user event', () => {
    const state = parse('a «b» c')
    let tr: Transaction | undefined
    expect(toggleInlineFormat('strong')({ state, dispatch: (t) => (tr = t) })).toBe(true)
    expect(tr?.isUserEvent('input.format')).toBe(true)
  })
})
