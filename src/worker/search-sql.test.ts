import { describe, expect, it } from 'vitest'
import { createD1 } from '../../test/support/d1'
import { SEARCH_ATOMS_MAX } from '../shared/limits'
import { parseSearch, type SearchQuery } from '../shared/search'
import { buildSearchWhere } from './search-sql'

function parse(input: string): SearchQuery {
  const result = parseSearch(input)
  if (!result.ok) throw new Error(result.error)
  return result.query
}

describe('buildSearchWhere', () => {
  it('returns null for a query with no groups', () => {
    expect(buildSearchWhere({ groups: [] }, 'owner@example.com')).toBeNull()
  })

  it('builds a single text atom', () => {
    const built = buildSearchWhere(parse('foo'), 'owner@example.com')
    expect(built).toEqual({
      sql: '((instr(lower(n.title), lower(?)) > 0 OR instr(lower(n.body_plain), lower(?)) > 0))',
      params: ['foo', 'foo'],
    })
  })

  it('builds an OR group of two ANDed groups, params in emission order', () => {
    const built = buildSearchWhere(parse('a OR b c'), 'owner@example.com')
    expect(built?.sql).toBe(
      '((instr(lower(n.title), lower(?)) > 0 OR instr(lower(n.body_plain), lower(?)) > 0) OR ' +
        '(instr(lower(n.title), lower(?)) > 0 OR instr(lower(n.body_plain), lower(?)) > 0)) AND ' +
        '((instr(lower(n.title), lower(?)) > 0 OR instr(lower(n.body_plain), lower(?)) > 0))',
    )
    expect(built?.params).toEqual(['a', 'a', 'b', 'b', 'c', 'c'])
  })

  it('builds a label atom with an owner-filtered EXISTS, and orders params [text, text, owner, label]', () => {
    const built = buildSearchWhere(parse('foo label:work'), 'owner@example.com')
    expect(built).toEqual({
      sql:
        '((instr(lower(n.title), lower(?)) > 0 OR instr(lower(n.body_plain), lower(?)) > 0)) AND ' +
        '(EXISTS (SELECT 1 FROM note_labels nl JOIN labels l ON l.id = nl.label_id WHERE nl.note_id = n.id AND l.owner = ? AND l.name = ? COLLATE NOCASE))',
      params: ['foo', 'foo', 'owner@example.com', 'work'],
    })
  })

  it('narrows a case-sensitive regex literal with a plain instr()', () => {
    const built = buildSearchWhere(parse('/foo\\d+bar/'), 'owner@example.com')
    expect(built).toEqual({
      sql: '((instr(n.title, ?) > 0 OR instr(n.body_plain, ?) > 0))',
      params: ['foo', 'foo'],
    })
  })

  it('narrows a regex with the i flag using lower() on both sides', () => {
    const built = buildSearchWhere(parse('/Foo/i'), 'owner@example.com')
    expect(built).toEqual({
      sql: '((instr(lower(n.title), lower(?)) > 0 OR instr(lower(n.body_plain), lower(?)) > 0))',
      params: ['Foo', 'Foo'],
    })
  })

  it('emits no SQL for a group with a literal-less regex, but keeps other groups', () => {
    expect(buildSearchWhere(parse('/\\d{3}-\\d{4}/'), 'o')).toBeNull()
    expect(buildSearchWhere(parse('/\\d+/ OR coffee'), 'o')).toBeNull()

    const built = buildSearchWhere(parse('/\\d+/ coffee'), 'o')
    expect(built).toEqual({
      sql: '((instr(lower(n.title), lower(?)) > 0 OR instr(lower(n.body_plain), lower(?)) > 0))',
      params: ['coffee', 'coffee'],
    })
  })

  it('does not narrow on a k or s literal under iu, where JS folds beyond ASCII', () => {
    expect(buildSearchWhere(parse('/kiosk/iu'), 'o')).toBeNull()
  })

  it('never emits LIKE, since D1 rejects LIKE patterns over 50 bytes', () => {
    const built = buildSearchWhere(parse('a OR b label:foo label:"bar baz"'), 'owner@example.com')
    expect(built?.sql).not.toMatch(/\bLIKE\b/i)
  })

  it('has exactly one `?` per bound param', () => {
    const built = buildSearchWhere(parse('a OR b label:foo label:"bar baz"'), 'owner@example.com')!
    expect((built.sql.match(/\?/g) ?? []).length).toBe(built.params.length)
  })

  it('stays within D1\'s 100-param cap at the maximum atom count', () => {
    const words = Array.from({ length: SEARCH_ATOMS_MAX }, (_, i) => `label:l${i}`)
    const built = buildSearchWhere(parse(words.join(' ')), 'owner@example.com')!
    expect(built.params.length).toBeLessThanOrEqual(100)
    expect(built.params.length).toBe(SEARCH_ATOMS_MAX * 2)
  })

  it('runs against the D1 shim and isolates labels by owner', async () => {
    const db = createD1()
    const now = Date.now()

    await db.batch([
      db.prepare("INSERT INTO notes (id, owner, title, body, body_plain, created_at, updated_at) VALUES ('n1','alice','Coffee shop','','Coffee shop',?,?)").bind(now, now),
      db.prepare("INSERT INTO notes (id, owner, title, body, body_plain, created_at, updated_at) VALUES ('n2','alice','Tea shop','','Tea shop',?,?)").bind(now, now),
      db.prepare("INSERT INTO notes (id, owner, title, body, body_plain, created_at, updated_at) VALUES ('n3','bob','Coffee shop','','Coffee shop',?,?)").bind(now, now),
      db.prepare("INSERT INTO labels (id, owner, name, created_at) VALUES ('l1','alice','Work',?)").bind(now),
      db.prepare("INSERT INTO labels (id, owner, name, created_at) VALUES ('l2','bob','Work',?)").bind(now),
      db.prepare("INSERT INTO note_labels (note_id, label_id) VALUES ('n1','l1')"),
      db.prepare("INSERT INTO note_labels (note_id, label_id) VALUES ('n3','l2')"),
    ])

    // ASCII case-insensitivity: 'COFFEE' matches lower-cased 'coffee'.
    const textMatch = buildSearchWhere(parse('COFFEE'), 'alice')!
    const textRows = await db
      .prepare(`SELECT n.id FROM notes n WHERE n.owner = ? AND ${textMatch.sql}`)
      .bind('alice', ...textMatch.params)
      .all()
    expect(textRows.results?.map((r) => (r as { id: string }).id)).toEqual(['n1'])

    // label:work must not match bob's same-named label for alice's query.
    const labelMatch = buildSearchWhere(parse('label:work'), 'alice')!
    const labelRows = await db
      .prepare(`SELECT n.id FROM notes n WHERE n.owner = ? AND ${labelMatch.sql}`)
      .bind('alice', ...labelMatch.params)
      .all()
    expect(labelRows.results?.map((r) => (r as { id: string }).id)).toEqual(['n1'])

    // A 20-character CJK term is 60 bytes in UTF-8: over D1's 50-byte LIKE
    // limit, but instr() has no such limit.
    const cjkTerm = '珈琲'.repeat(10)
    await db
      .prepare("INSERT INTO notes (id, owner, title, body, body_plain, created_at, updated_at) VALUES ('n4','alice',?,'',?,?,?)")
      .bind(cjkTerm, cjkTerm, now, now)
      .run()
    const cjkMatch = buildSearchWhere(parse(cjkTerm), 'alice')!
    const cjkRows = await db
      .prepare(`SELECT n.id FROM notes n WHERE n.owner = ? AND ${cjkMatch.sql}`)
      .bind('alice', ...cjkMatch.params)
      .all()
    expect(cjkRows.results?.map((r) => (r as { id: string }).id)).toEqual(['n4'])

    // `%` and `_` are literal, since instr() is not a LIKE pattern: a decoy
    // row that would match `50% off_sale` under LIKE wildcard semantics
    // (`%` as any-run, `_` as any-char) must not match here.
    await db.batch([
      db.prepare(
        "INSERT INTO notes (id, owner, title, body, body_plain, created_at, updated_at) VALUES ('n5','alice','50% off_sale','','50% off_sale',?,?)",
      ).bind(now, now),
      db.prepare(
        "INSERT INTO notes (id, owner, title, body, body_plain, created_at, updated_at) VALUES ('n6','alice','500 offXsale','','500 offXsale',?,?)",
      ).bind(now, now),
    ])
    const percentMatch = buildSearchWhere(parse('50% off_sale'), 'alice')!
    const percentRows = await db
      .prepare(`SELECT n.id FROM notes n WHERE n.owner = ? AND ${percentMatch.sql}`)
      .bind('alice', ...percentMatch.params)
      .all()
    expect(percentRows.results?.map((r) => (r as { id: string }).id)).toEqual(['n5'])
  })
})
