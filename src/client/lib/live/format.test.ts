import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport, syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type Extension, type SelectionRange, type Transaction } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { keymap } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { formatKeymap, formatKeys, type InlineFormat, toggleInlineFormat } from './format'

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
})

describe('toggleInlineFormat: empty selection outside an element', () => {
  it.each<[InlineFormat, string, string]>([
    ['strong', 'hel|lo world', '**hel|lo** world'],
    ['strong', 'hello| world', '**hello|** world'],
    ['strong', 'hello |world', 'hello **|world**'],
    ['strong', 'foo_bar|', '**foo_bar|**'],
    ['strong', '*e|m*', '***e|m***'],
    ['strong', 'a | b', 'a **|** b'],
    ['code', '|', '`|`'],
    ['strike', 'x|', '~~x|~~'],
  ])('%s: %s -> %s', (format, before, after) => {
    expect(run(format, before)).toBe(after)
  })

  it('wraps a word at every cursor', () => {
    expect(run('strong', 'a| b|')).toBe('**a|** **b|**')
  })

  it('wraps a single word of a Japanese sentence, not the whole clause', () => {
    const out = run('strong', '今日はいい天|気です')
    expect(out.split('**')).toHaveLength(3)
    const wrapped = out.split('**')[1]?.replace('|', '') ?? ''
    expect(wrapped).toContain('天')
    expect(wrapped.length).toBeLessThan('今日はいい天気です'.length)
  })
})

describe('toggleInlineFormat: remove from an existing element', () => {
  it.each<[InlineFormat, string, string]>([
    ['strong', '**bo|ld**', 'bo|ld'],
    ['strong', '**bold**|', 'bold|'],
    ['strong', '|**bold**', '|bold'],
    ['strong', '«**bold**»', '«bold»'],
    ['strong', '**b«ol»d**', 'b«ol»d'],
    ['strong', '__|b__', '|b'],
    ['emphasis', '_e|m_', 'e|m'],
    ['code', '`c|ode`', 'c|ode'],
    ['code', '``a|`b``', 'a|`b'],
    ['strike', '~~|s~~', '|s'],
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

describe('formatKeys', () => {
  it('binds the four shortcuts', () => {
    expect(formatKeymap.map((b) => b.key)).toEqual(['Mod-b', 'Mod-i', 'Mod-e', 'Mod-Shift-x'])
  })

  it('takes Mod-i over selectParentSyntax from defaultKeymap', () => {
    const state = EditorState.create({ extensions: [keymap.of(defaultKeymap), formatKeys] })
    expect(state.facet(keymap).flat().find((b) => b.key === 'Mod-i')).toBe(formatKeymap[1])
  })
})

describe('cursor at the end of a run', () => {
  it.each<[InlineFormat, string, string]>([
    ['strong', '**bold|**', '**bold**|'],
    ['emphasis', '*em|*', '*em*|'],
    ['code', '`c|`', '`c`|'],
    ['strike', '~~s|~~', '~~s~~|'],
    ['strong', '***foo|***', '***foo**|*'],
    ['emphasis', '***foo**|*', '***foo***|'],
  ])('%s on %s steps out to %s', (format, input, expected) => {
    expect(run(format, input)).toBe(expected)
  })
})
