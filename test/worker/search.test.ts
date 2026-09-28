import { describe, expect, it } from 'vitest'
import { SEARCH_ATOMS_MAX, SEARCH_QUERY_MAX_CHARS } from '../../src/shared/limits'
import type { ApiErrorBody, Note, NoteListResponse } from '../../src/shared/types'
import { call, createTestEnv } from '../support/env'

async function createNote(env: Parameters<typeof call>[0], body: Record<string, unknown> = {}): Promise<Note> {
  const response = await call(env, '/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as Note
}

function trashNote(env: Parameters<typeof call>[0], id: string): Promise<Response> {
  return call(env, `/api/notes/${id}/trash`, { method: 'POST' })
}

async function search(env: Parameters<typeof call>[0], q: string, extra = ''): Promise<Response> {
  return call(env, `/api/notes?q=${encodeURIComponent(q)}${extra}`)
}

async function titles(env: Parameters<typeof call>[0], q: string, extra = ''): Promise<string[]> {
  const response = await search(env, q, extra)
  expect(response.status).toBe(200)
  const body = (await response.json()) as NoteListResponse
  return body.items.map((item) => item.title)
}

describe('GET /api/notes?q=', () => {
  it('ANDs neighbouring atoms', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'Coffee shop', body: '' })
    await createNote(env, { title: 'Coffee beans', body: '' })
    await createNote(env, { title: 'Tea shop', body: '' })

    expect(await titles(env, 'coffee shop')).toEqual(['Coffee shop'])
  })

  it('ORs atoms joined by a bare OR', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'Coffee', body: '' })
    await createNote(env, { title: 'Tea', body: '' })
    await createNote(env, { title: 'Water', body: '' })

    const results = await titles(env, 'coffee OR tea')
    expect(new Set(results)).toEqual(new Set(['Coffee', 'Tea']))
  })

  it('matches a phrase containing a space', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'Coffee shop', body: '' })
    await createNote(env, { title: 'Coffee', body: 'a shop nearby' })

    expect(await titles(env, '"coffee shop"')).toEqual(['Coffee shop'])
  })

  it('combines label: with a text atom', async () => {
    const env = createTestEnv()
    const work = await createNote(env, { title: 'Coffee shop', body: '', labels: ['work'] })
    await createNote(env, { title: 'Coffee shop', body: '', labels: ['home'] })

    const results = await titles(env, 'coffee label:work')
    expect(results).toEqual(['Coffee shop'])

    const response = await search(env, 'coffee label:work')
    const body = (await response.json()) as NoteListResponse
    expect(body.items[0]?.id).toBe(work.id)
  })

  it('matches case-insensitively for ASCII', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'COFFEE Shop', body: '' })

    expect(await titles(env, 'coffee')).toEqual(['COFFEE Shop'])
  })

  it('matches a 60-byte Japanese term', async () => {
    const env = createTestEnv()
    const term = '珈琲'.repeat(10) // 20 chars, 60 bytes in UTF-8
    await createNote(env, { title: term, body: '' })
    await createNote(env, { title: 'unrelated', body: '' })

    expect(await titles(env, term)).toEqual([term])
  })

  it('treats % and _ literally, not as LIKE wildcards', async () => {
    const env = createTestEnv()
    await createNote(env, { title: '50% off_sale', body: '' })
    await createNote(env, { title: '500 offXsale', body: '' })

    expect(await titles(env, '50% off_sale')).toEqual(['50% off_sale'])
  })

  it('excludes trashed notes under view=all when searching', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'Coffee shop', body: '' })
    await trashNote(env, note.id)
    await createNote(env, { title: 'Coffee beans', body: '' })

    expect(await titles(env, 'coffee', '&view=all')).toEqual(['Coffee beans'])
  })

  it('composes q with label and cursor paging, in one binding order', async () => {
    const env = createTestEnv()
    const a = await createNote(env, { title: 'Coffee shop', body: '', labels: ['work'] })
    const b = await createNote(env, { title: 'Coffee house', body: '', labels: ['work'] })
    await createNote(env, { title: 'Coffee bar', body: '', labels: ['home'] })

    const first = await search(env, 'coffee', '&label=work&limit=1')
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as NoteListResponse
    expect(firstBody.items).toHaveLength(1)
    expect(firstBody.nextCursor).not.toBeNull()

    const second = await search(env, 'coffee', `&label=work&limit=1&cursor=${encodeURIComponent(firstBody.nextCursor!)}`)
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as NoteListResponse
    expect(secondBody.items).toHaveLength(1)
    expect(secondBody.nextCursor).toBeNull()

    const ids = new Set([...firstBody.items, ...secondBody.items].map((item) => item.id))
    expect(ids).toEqual(new Set([a.id, b.id]))
  })

  it('returns 400 bad_query when the query has too many atoms', async () => {
    const env = createTestEnv()
    const words = Array.from({ length: SEARCH_ATOMS_MAX + 1 }, (_, i) => `word${i}`).join(' ')

    const response = await search(env, words)
    expect(response.status).toBe(400)
    const body = (await response.json()) as ApiErrorBody
    expect(body.error).toBe('bad_query')
  })

  it('returns 400 bad_query when the query is too long', async () => {
    const env = createTestEnv()
    const tooLong = 'a'.repeat(SEARCH_QUERY_MAX_CHARS + 1)

    const response = await search(env, tooLong)
    expect(response.status).toBe(400)
    const body = (await response.json()) as ApiErrorBody
    expect(body.error).toBe('bad_query')
  })
})
