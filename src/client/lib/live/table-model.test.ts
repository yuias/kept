import { markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageSupport, syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { activeLineNumbers } from './active-lines'
import { collectTables, isRenderedTable, readAlignments, type TableBlock, type TableCell } from './table-model'

function firstTable(doc: string): TableBlock {
  const [table] = collectTables(stateFor(doc))
  if (!table) throw new Error('no table')
  return table
}

function stateFor(doc: string, anchor = 0, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [new LanguageSupport(markdownLanguage)],
  })
}

const text = (value: string): TableCell => [{ kind: 'text', text: value }]

describe('column mapping', () => {
  it('maps cells to columns by pipe position, leaving an empty cell empty', () => {
    const table = firstTable('| a |  | c |\n|---|---|---|\n| x | y |')
    expect(table.model.header).toEqual([text('a'), [], text('c')])
    expect(table.model.rows).toEqual([[text('x'), text('y'), []]])
  })

  it('maps a row without outer pipes to columns 0 and 1', () => {
    const table = firstTable('a | b\n--|--\nx | y')
    expect(table.model.rows).toEqual([[text('x'), text('y')]])
  })

  it('pads a short row', () => {
    const table = firstTable('| a | b | c |\n|---|---|---|\n| 1 |')
    expect(table.model.rows).toEqual([[text('1'), [], []]])
  })

  it('drops cells beyond the header column count', () => {
    const table = firstTable('| a | b |\n|---|---|\n| 1 | 2 | 3 |')
    expect(table.model.rows).toEqual([[text('1'), text('2')]])
  })

  it('keeps a row of only empty cells at the column count', () => {
    const table = firstTable('| a | b |\n|---|---|\n|  |  |')
    expect(table.model.rows).toEqual([[[], []]])
  })
})

describe('readAlignments', () => {
  it('reads left, center, right and none', () => {
    expect(readAlignments('| :-- | :-: | --: | --- |')).toEqual(['left', 'center', 'right', null])
  })

  it('reads a row without outer pipes', () => {
    expect(readAlignments(':-:|--')).toEqual(['center', null])
  })
})

describe('collectTables', () => {
  it('collects a table with its line span, source and model', () => {
    const doc = 'intro\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\nafter'
    const from = doc.indexOf('| a')
    const source = '| a | b |\n|---|--:|\n| 1 | 2 |'
    expect(collectTables(stateFor(doc))).toEqual([
      {
        from,
        to: from + source.length,
        source,
        model: { align: [null, 'right'], header: [text('a'), text('b')], rows: [[text('1'), text('2')]] },
      },
    ])
  })

  it('ends at the last row line with or without a trailing newline', () => {
    const base = 'x\n\n| a |\n|---|\n| 1 |'
    for (const doc of [base, `${base}\n`]) {
      const table = firstTable(doc)
      expect(table.to).toBe(base.length)
      expect(table.source.endsWith('| 1 |')).toBe(true)
    }
  })

  it('ignores tables in a blockquote and in a list item', () => {
    expect(collectTables(stateFor('> | a |\n> |---|\n> | 1 |'))).toEqual([])
    expect(collectTables(stateFor('- | a |\n  |---|\n  | 1 |'))).toEqual([])
  })
})

describe('isRenderedTable', () => {
  const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n\nafter'
  const rendered = (state: EditorState): boolean => {
    const node = syntaxTree(state).topNode.firstChild
    if (node?.name !== 'Table') throw new Error('no table')
    return isRenderedTable(state, activeLineNumbers(state), node)
  }

  it('is false while the caret is on the header, delimiter or last row', () => {
    expect(rendered(stateFor(doc, 2))).toBe(false)
    expect(rendered(stateFor(doc, doc.indexOf('|---') + 1))).toBe(false)
    expect(rendered(stateFor(doc, doc.indexOf('| 1') + 2))).toBe(false)
  })

  it('is false for a selection that starts above the table and ends inside it', () => {
    const state = stateFor(`above\n\n${doc}`, 2, `above\n\n${doc}`.indexOf('| 1') + 2)
    const table = syntaxTree(state).topNode.getChild('Table')
    if (!table) throw new Error('no table')
    expect(isRenderedTable(state, activeLineNumbers(state), table)).toBe(false)
  })

  it('is true when the caret is on the paragraph after a blank line', () => {
    expect(rendered(stateFor(doc, doc.length))).toBe(true)
  })

  it('is false for a table nested in a blockquote', () => {
    const quoted = '> | a |\n> |---|\n> | 1 |\n\nafter'
    const state = stateFor(quoted, quoted.length)
    let nested = false
    syntaxTree(state).iterate({
      enter: (ref) => {
        if (ref.name === 'Table') nested = isRenderedTable(state, activeLineNumbers(state), ref.node)
      },
    })
    expect(nested).toBe(false)
  })
})
