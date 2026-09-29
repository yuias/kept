import { afterEach, describe, expect, it } from 'vitest'
import { REGEX_ROW_CHARS_MAX } from '../../src/shared/limits'
import type { ApiErrorBody, Note, NoteListResponse } from '../../src/shared/types'
import { setRegexScanLimitsForTest } from '../../src/worker/notes-repo'
import { call, createTestEnv } from '../support/env'

type Env = Parameters<typeof call>[0]

async function createNote(env: Env, body: Record<string, unknown>): Promise<Note> {
  const response = await call(env, '/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as Note
}

async function search(env: Env, q: string, extra = ''): Promise<NoteListResponse> {
  const response = await call(env, `/api/notes?q=${encodeURIComponent(q)}${extra}`)
  expect(response.status).toBe(200)
  return (await response.json()) as NoteListResponse
}

async function titles(env: Env, q: string): Promise<string[]> {
  return (await search(env, q)).items.map((item) => item.title).sort()
}

afterEach(() => setRegexScanLimitsForTest(null))

describe('regex search', () => {
  it('returns the local images of a matching note', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'pics', body: 'intro\n\n![](/img/a1)\n\n![](https://example.com/c.png)' })

    const { items } = await search(env, '/intro/')
    expect(items).toHaveLength(1)
    expect(items[0]?.images).toEqual(['/img/a1'])
  })

  it('matches in the title and in the body', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'invoice-2024', body: '' })
    await createNote(env, { title: 'other', body: 'see invoice-1999 here' })
    await createNote(env, { title: 'nothing', body: 'no digits' })

    expect(await titles(env, '/invoice-\\d{4}/')).toEqual(['invoice-2024', 'other'])
  })

  it('does not join a match across the title and the body', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'abc', body: 'def' })

    expect(await titles(env, '/abcdef/')).toEqual([])
  })

  it('matches a regex OR text group', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'order 123', body: '' })
    await createNote(env, { title: 'Coffee', body: '' })
    await createNote(env, { title: 'Water', body: '' })

    expect(await titles(env, '/order \\d+/ OR coffee')).toEqual(['Coffee', 'order 123'])
  })

  it('still works for a regex with no required literal', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'call', body: 'tel 555-1234 now' })
    await createNote(env, { title: 'skip', body: 'tel 55-1234' })

    expect(await titles(env, '/\\d{3}-\\d{4}/')).toEqual(['call'])
  })

  it('does not narrow an OR group holding a literal-less regex', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'a 42 b', body: '' })
    await createNote(env, { title: 'plain coffee', body: '' })
    await createNote(env, { title: 'nope', body: '' })

    expect(await titles(env, '/\\d+/ OR coffee')).toEqual(['a 42 b', 'plain coffee'])
  })

  it('is case-sensitive without the i flag and case-insensitive with it', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'Foobar', body: '' })
    await createNote(env, { title: 'foobar', body: '' })

    expect(await titles(env, '/foobar/')).toEqual(['foobar'])
    expect(await titles(env, '/FOOBAR/i')).toEqual(['Foobar', 'foobar'])
  })

  it('combines a regex with label: and text atoms, all in JS-exact form', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'ticket 7', body: 'coffee', labels: ['Work'] })
    await createNote(env, { title: 'ticket 8', body: 'tea', labels: ['Work'] })
    await createNote(env, { title: 'ticket 9', body: 'coffee', labels: ['home'] })

    expect(await titles(env, '/ticket \\d/ coffee label:work')).toEqual(['ticket 7'])
  })

  it('matches a pattern that contains spaces', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'hello big world', body: '' })
    await createNote(env, { title: 'hello world', body: '' })

    expect(await titles(env, '/hello .* world/')).toEqual(['hello big world'])
  })

  it('only tests the first REGEX_ROW_CHARS_MAX chars of a body', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'far', body: `${'x '.repeat(REGEX_ROW_CHARS_MAX)}needle` })
    await createNote(env, { title: 'near', body: 'needle' })

    expect(await titles(env, '/needle/')).toEqual(['near'])
    // A plain text atom is not truncated.
    expect(await titles(env, 'needle')).toEqual(['far', 'near'])
  })

  it('returns 400 for an invalid regex', async () => {
    const env = createTestEnv()
    for (const q of ['/(/', '/a/x', '/(a+)+/', '/a{2,1}/']) {
      const response = await call(env, `/api/notes?q=${encodeURIComponent(q)}`)
      expect(response.status).toBe(400)
      const body = (await response.json()) as ApiErrorBody
      expect(body.error).toBeTruthy()
    }
  })
})

// Patterns here have no required literal, so SQL cannot narrow and every row is scanned.
async function collect(env: Env, q: string, extra: string): Promise<{ pages: NoteListResponse[]; ids: string[] }> {
  const pages: NoteListResponse[] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 20; guard++) {
    const page: NoteListResponse = await search(env, q, `${extra}${cursor ? `&cursor=${cursor}` : ''}`)
    pages.push(page)
    cursor = page.nextCursor
    if (!cursor) break
  }
  return { pages, ids: pages.flatMap((page) => page.items.map((item) => item.id)) }
}

describe('regex scan guards', () => {
  it('sets scanLimited and resumes from nextCursor when the row guard trips', async () => {
    const env = createTestEnv()
    for (let i = 0; i < 6; i++) await createNote(env, { title: `note ${i}`, body: i % 2 === 0 ? 'v12' : 'v1' })
    setRegexScanLimitsForTest({ rowsMax: 2 })

    const seen: string[] = []
    let cursor: string | null = null
    let limitedPages = 0
    for (let guard = 0; guard < 10; guard++) {
      const page: NoteListResponse = await search(env, '/\\d{2}/', cursor ? `&cursor=${cursor}` : '')
      seen.push(...page.items.map((item) => item.title))
      if (page.scanLimited) limitedPages += 1
      cursor = page.nextCursor
      if (!cursor) break
    }

    expect(cursor).toBeNull()
    expect(limitedPages).toBe(2)
    expect(seen.sort()).toEqual(['note 0', 'note 2', 'note 4'])
  })

  it('reports scanLimited with a resumable cursor even when nothing matched', async () => {
    const env = createTestEnv()
    for (let i = 0; i < 5; i++) await createNote(env, { title: `n${i}`, body: 'v1' })
    setRegexScanLimitsForTest({ rowsMax: 3 })

    const first = await search(env, '/\\d{2}/')
    expect(first.items).toEqual([])
    expect(first.scanLimited).toBe(true)
    expect(first.nextCursor).toBeTruthy()

    const second = await search(env, '/\\d{2}/', `&cursor=${first.nextCursor}`)
    expect(second.items).toEqual([])
    expect(second.scanLimited).toBeUndefined()
    expect(second.nextCursor).toBeNull()
  })

  it('does not set scanLimited when the list ends exactly at the row guard', async () => {
    const env = createTestEnv()
    for (let i = 0; i < 3; i++) await createNote(env, { title: `n${i}`, body: 'v1' })
    setRegexScanLimitsForTest({ rowsMax: 3 })

    const page = await search(env, '/\\d{2}/')
    expect(page.scanLimited).toBeUndefined()
    expect(page.nextCursor).toBeNull()
  })

  it('stops at limit and resumes from the last scanned row', async () => {
    const env = createTestEnv()
    for (let i = 0; i < 5; i++) await createNote(env, { title: `note ${i}`, body: 'v12' })

    const first = await search(env, '/\\d{2}/', '&limit=2')
    expect(first.items).toHaveLength(2)
    expect(first.scanLimited).toBeUndefined()
    expect(first.nextCursor).toBeTruthy()

    const second = await search(env, '/\\d{2}/', `&limit=10&cursor=${first.nextCursor}`)
    expect(second.items).toHaveLength(3)
    expect(second.nextCursor).toBeNull()
    const all = [...first.items, ...second.items].map((item) => item.id)
    expect(new Set(all).size).toBe(5)
  })

  it('continues across batches without duplicating or skipping rows', async () => {
    const env = createTestEnv()
    const expected: string[] = []
    for (let i = 0; i < 9; i++) {
      const note = await createNote(env, { title: `note ${i}`, body: i % 3 === 0 ? 'v1' : 'v12' })
      if (i % 3 !== 0) expected.push(note.id)
    }
    setRegexScanLimitsForTest({ batchSize: 2 })

    // One request spanning several batches.
    const whole = await collect(env, '/\\d{2}/', '&limit=100')
    expect(whole.pages).toHaveLength(1)
    expect(whole.ids.sort()).toEqual([...expected].sort())

    // Resuming across requests, each ending mid-batch.
    const paged = await collect(env, '/\\d{2}/', '&limit=2')
    expect(paged.ids).toHaveLength(expected.length)
    expect(new Set(paged.ids).size).toBe(expected.length)
    expect(paged.ids.sort()).toEqual([...expected].sort())
    // Same order as the single request.
    expect(paged.ids).toEqual(whole.ids)
  })

  it('binds text-atom columns and later filters in the right order', async () => {
    const env = createTestEnv()
    const keep = await createNote(env, { title: 'Coffee 12', body: '', labels: ['work'] })
    await createNote(env, { title: 'Coffee 1', body: '', labels: ['work'] })
    await createNote(env, { title: 'Tea 12', body: '', labels: ['work'] })
    await createNote(env, { title: 'Coffee 12', body: '', labels: ['home'] })

    const page = await search(env, '/\\d{2}/ COFFEE label:work', '&folder=root')
    expect(page.items.map((item) => item.id)).toEqual([keep.id])
  })

  it('sets scanLimited when the char guard trips and resumes at the first unscanned row', async () => {
    const env = createTestEnv()
    for (let i = 0; i < 6; i++) await createNote(env, { title: `note ${i}`, body: 'v12' })
    // Each body is 3 chars: rows are scanned while the total is below 7, so 3 rows per request.
    setRegexScanLimitsForTest({ charsMax: 7 })

    const first = await search(env, '/\\d{2}/')
    expect(first.items).toHaveLength(3)
    expect(first.scanLimited).toBe(true)
    expect(first.nextCursor).toBeTruthy()

    const second = await search(env, '/\\d{2}/', `&cursor=${first.nextCursor}`)
    expect(second.items).toHaveLength(3)
    expect(second.scanLimited).toBeUndefined()
    expect(second.nextCursor).toBeNull()

    const ids = [...first.items, ...second.items].map((item) => item.id)
    expect(new Set(ids).size).toBe(6)
  })

  it('rejects a non-positive test override', () => {
    expect(() => setRegexScanLimitsForTest({ rowsMax: 0 })).toThrow(RangeError)
  })
})
