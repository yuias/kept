import { describe, expect, it } from 'vitest'
import { roundTrip } from './markdown'

const load = (files: Record<string, string>, suffix: string): Map<string, string> =>
  new Map(
    Object.entries(files).map(([path, text]) => [path.slice(path.lastIndexOf('/') + 1, -suffix.length), text]),
  )

const identical = load(
  import.meta.glob('./fixtures/identical/*.md', { query: '?raw', import: 'default', eager: true }),
  '.md',
)
const normalizeIn = load(
  import.meta.glob('./fixtures/normalize/*.in.md', { query: '?raw', import: 'default', eager: true }),
  '.in.md',
)
const normalizeOut = load(
  import.meta.glob('./fixtures/normalize/*.out.md', { query: '?raw', import: 'default', eager: true }),
  '.out.md',
)

/**
 * Fixtures whose conversion is not supported yet. The tests below assert that
 * each one still fails, so an entry that starts passing must be removed here.
 */
const KNOWN_LOSSY = new Set<string>([
  'bare-urls',
  'images',
  'inline',
  'links',
  'list-code',
  'literal-markers',
  'tables',
  'bullets-star',
  'check-upper',
  'rule-variants',
  'table-padding',
  'tilde-fence',
])

const passesIdentical = (name: string): boolean => {
  const source = identical.get(name)!
  return roundTrip(source) === source
}

const passesNormalize = (name: string): boolean => {
  const output = normalizeOut.get(name)!
  return roundTrip(normalizeIn.get(name)!) === output && roundTrip(output) === output
}

describe('round-trip fixtures', () => {
  it('has a fixture for every known lossy name', () => {
    for (const name of KNOWN_LOSSY) {
      expect(identical.has(name) || normalizeIn.has(name), name).toBe(true)
    }
  })

  it('pairs every normalize input with an expected output', () => {
    expect([...normalizeIn.keys()].sort()).toEqual([...normalizeOut.keys()].sort())
  })

  describe('identical', () => {
    for (const [name, source] of identical) {
      it(name, () => {
        if (KNOWN_LOSSY.has(name)) expect(passesIdentical(name), 'now passes: remove it from KNOWN_LOSSY').toBe(false)
        else expect(roundTrip(source)).toBe(source)
      })
    }
  })

  describe('normalize', () => {
    for (const [name, source] of normalizeIn) {
      it(name, () => {
        if (KNOWN_LOSSY.has(name)) {
          expect(passesNormalize(name), 'now passes: remove it from KNOWN_LOSSY').toBe(false)
          return
        }
        const output = normalizeOut.get(name)!
        expect(roundTrip(source)).toBe(output)
        expect(roundTrip(output)).toBe(output)
      })
    }
  })
})
