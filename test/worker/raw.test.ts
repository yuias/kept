import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, Note } from '../../src/shared/types'
import { generateId } from '../../src/worker/id'
import { ANON, call, createTestEnv } from '../support/env'

const OTHER_OWNER = 'other@example.com'

async function createNote(env: Parameters<typeof call>[0], body: Record<string, unknown> = {}): Promise<Note> {
  const response = await call(env, '/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as Note
}

/** Inserts a note row directly, bypassing the API, to simulate another owner's data. */
async function insertNote(env: Parameters<typeof call>[0], owner: string, title = ''): Promise<string> {
  const id = generateId()
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO notes (id, owner, title, body, body_plain, format, pinned, archived, created_at, updated_at)
     VALUES (?, ?, ?, 'body', 'body', 'inherit', 0, 0, ?, ?)`,
  )
    .bind(id, owner, title, now, now)
    .run()
  return id
}

describe('GET /raw/:id', () => {
  it('returns text/markdown with the title heading prepended when a title exists', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'Hello', body: 'World' })

    const response = await call(env, `/raw/${note.id}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('# Hello\n\nWorld')
  })

  it('omits the title heading when the title is empty', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: '', body: 'World' })

    const response = await call(env, `/raw/${note.id}`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('World')
  })

  it('?download gives an attachment with an RFC 5987 encoded filename', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'Café Notes', body: 'World' })

    const response = await call(env, `/raw/${note.id}?download`)
    expect(response.status).toBe(200)
    const disposition = response.headers.get('content-disposition') ?? ''
    expect(disposition).toContain('attachment;')
    expect(disposition).toContain('filename="Caf_ Notes.md"')
    expect(disposition).toContain("filename*=UTF-8''Caf%C3%A9%20Notes.md")
  })

  it('does not set content-disposition without ?download', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'Hello', body: 'World' })

    const response = await call(env, `/raw/${note.id}`)
    expect(response.headers.get('content-disposition')).toBeNull()
  })

  it("404s on another owner's note", async () => {
    const env = createTestEnv()
    const id = await insertNote(env, OTHER_OWNER, 'Secret')

    const response = await call(env, `/raw/${id}`)
    expect(response.status).toBe(404)
    const body = (await response.json()) as ApiErrorBody
    expect(body.error).toBe('not_found')
  })

  it('404s on an unknown id', async () => {
    const env = createTestEnv()
    const response = await call(env, `/raw/${generateId()}`)
    expect(response.status).toBe(404)
  })

  it('404s on a badly formatted id', async () => {
    const env = createTestEnv()
    const response = await call(env, '/raw/not-a-valid-id')
    expect(response.status).toBe(404)
  })

  it('401s for an existing note when anonymous', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'Hello', body: 'World' })

    const response = await call(env, `/raw/${note.id}`, { headers: ANON })
    expect(response.status).toBe(401)
  })
})
