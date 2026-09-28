import { describe, expect, it } from 'vitest'
import { canChangeFormat, effectiveFormat } from './format'
import type { AppSettings, NoteFormat } from './types'

const FORMATS: readonly NoteFormat[] = ['inherit', 'formatted', 'syntax']

describe('canChangeFormat', () => {
  const expected: Record<string, boolean> = {
    'inherit->inherit': true,
    'inherit->formatted': true,
    'inherit->syntax': true,
    'formatted->inherit': false,
    'formatted->formatted': true,
    'formatted->syntax': true,
    'syntax->inherit': false,
    'syntax->formatted': true,
    'syntax->syntax': true,
  }

  for (const from of FORMATS) {
    for (const to of FORMATS) {
      it(`${from} -> ${to}`, () => {
        expect(canChangeFormat(from, to)).toBe(expected[`${from}->${to}`])
      })
    }
  }
})

describe('effectiveFormat', () => {
  const settings: AppSettings = { defaultFormat: 'syntax', folderSort: 'name' }

  it('maps inherit to the default format', () => {
    expect(effectiveFormat('inherit', settings)).toBe('syntax')
  })

  it('leaves a concrete format unchanged', () => {
    expect(effectiveFormat('formatted', settings)).toBe('formatted')
  })
})
