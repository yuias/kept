import { describe, expect, it } from 'vitest'
import { markdownToPlain } from '../../src/shared/plaintext'
import type { ApiErrorBody, Note, NoteListResponse } from '../../src/shared/types'
import { generateId } from '../../src/worker/id'
import { updateNote } from '../../src/worker/notes-repo'
import { ANON, call, createTestEnv } from '../support/env'

const DEV_OWNER = 'dev@localhost'
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

function patchNote(env: Parameters<typeof call>[0], id: string, body: Record<string, unknown>): Promise<Response> {
  return call(env, `/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Inserts a folder row directly, bypassing the (not-yet-built) folders API. */
async function insertFolder(env: Parameters<typeof call>[0], owner: string): Promise<string> {
  const id = generateId()
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO folders (id, owner, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, NULL, ?, 0, ?, ?)',
  )
    .bind(id, owner, 'Folder', now, now)
    .run()
  return id
}

async function insertNote(
  env: Parameters<typeof call>[0],
  owner: string,
  overrides: { title?: string; pinned?: number } = {},
): Promise<string> {
  const id = generateId()
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO notes (id, owner, title, body, body_plain, format, pinned, archived, created_at, updated_at)
     VALUES (?, ?, ?, '', '', 'inherit', ?, 0, ?, ?)`,
  )
    .bind(id, owner, overrides.title ?? '', overrides.pinned ?? 0, now, now)
    .run()
  return id
}

describe('POST /api/notes and GET /api/notes/:id', () => {
  it('creates a note with format inherit and round-trips it through GET', async () => {
    const env = createTestEnv()
    const created = await createNote(env, { title: 'Hello', body: '**hi**' })

    expect(created.format).toBe('inherit')
    expect(created.title).toBe('Hello')
    expect(created.labels).toEqual([])

    const response = await call(env, `/api/notes/${created.id}`)
    expect(response.status).toBe(200)
    const fetched = (await response.json()) as Note
    expect(fetched).toEqual(created)
  })

  it('rejects a folderId belonging to another owner with 400 folder_not_found', async () => {
    const env = createTestEnv()
    const otherFolderId = await insertFolder(env, OTHER_OWNER)

    const response = await call(env, '/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', folderId: otherFolderId }),
    })

    expect(response.status).toBe(400)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('folder_not_found')
  })

  it('accepts a folderId belonging to the same owner', async () => {
    const env = createTestEnv()
    const ownFolderId = await insertFolder(env, DEV_OWNER)

    const created = await createNote(env, { title: 'x', folderId: ownFolderId })
    expect(created.folderId).toBe(ownFolderId)
  })

  it('rejects an oversized body with 413', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'a'.repeat(513 * 1024) }),
    })
    expect(response.status).toBe(413)
  })

  it('reports a note owned by another user as 404, and excludes it from the list', async () => {
    const env = createTestEnv()
    const otherId = await insertNote(env, OTHER_OWNER)

    const getResponse = await call(env, `/api/notes/${otherId}`)
    expect(getResponse.status).toBe(404)

    const listResponse = await call(env, '/api/notes')
    const listBody = (await listResponse.json()) as NoteListResponse
    expect(listBody.items.map((item) => item.id)).not.toContain(otherId)
  })

  it('returns 401 for an anonymous request', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/notes', { headers: ANON })
    expect(response.status).toBe(401)
  })

  it('rejects a wrong-typed field with 400 instead of silently ignoring it', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 123 }),
    })
    expect(response.status).toBe(400)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('bad_request')
  })

  it('rejects a request whose declared content-length is implausibly large, before parsing it', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(10 * 1024 * 1024) },
      body: JSON.stringify({ title: 'x' }),
    })
    expect(response.status).toBe(413)
  })
})

describe('PATCH /api/notes/:id', () => {
  it('updates the body, bumps updated_at, and recomputes body_plain', async () => {
    const env = createTestEnv()
    const created = await createNote(env, { title: 'x', body: 'old' })

    // Backdate so a same-millisecond PATCH in a fast test run still shows a
    // strictly later updated_at.
    await env.DB.prepare('UPDATE notes SET updated_at = updated_at - 1000 WHERE id = ?').bind(created.id).run()

    const newBody = '# Heading\n\nSome *text*.'
    const response = await patchNote(env, created.id, { body: newBody })
    expect(response.status).toBe(200)
    const updated = (await response.json()) as Note

    expect(updated.body).toBe(newBody)
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt - 1000)

    const row = await env.DB.prepare('SELECT body_plain FROM notes WHERE id = ?')
      .bind(created.id)
      .first<{ body_plain: string }>()
    expect(row?.body_plain).toBe(markdownToPlain(newBody))
  })

  it('rejects a folderId belonging to another owner on update with 400 folder_not_found', async () => {
    const env = createTestEnv()
    const created = await createNote(env, { title: 'x' })
    const otherFolderId = await insertFolder(env, OTHER_OWNER)

    const response = await patchNote(env, created.id, { folderId: otherFolderId })
    expect(response.status).toBe(400)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('folder_not_found')
  })

  it('allows inherit -> syntax, then refuses syntax -> inherit with 409 format_locked', async () => {
    const env = createTestEnv()
    const created = await createNote(env, { title: 'x' })

    const first = await patchNote(env, created.id, { format: 'syntax' })
    expect(first.status).toBe(200)
    expect(((await first.json()) as Note).format).toBe('syntax')

    const second = await patchNote(env, created.id, { format: 'inherit' })
    expect(second.status).toBe(409)
    const errorBody = (await second.json()) as ApiErrorBody
    expect(errorBody.error).toBe('format_locked')
  })

  it('rejects pinned and archived both true with 400', async () => {
    const env = createTestEnv()
    const created = await createNote(env, { title: 'x' })

    const response = await patchNote(env, created.id, { pinned: true, archived: true })
    expect(response.status).toBe(400)
  })

  it('rejects a wrong-typed field with 400 instead of silently ignoring it', async () => {
    const env = createTestEnv()
    const created = await createNote(env, { title: 'x' })

    const response = await patchNote(env, created.id, { pinned: 'true' })
    expect(response.status).toBe(400)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('bad_request')
  })

  it('keeps the format lock intact under two overlapping updateNote calls', async () => {
    const env = createTestEnv()
    const created = await createNote(env, { title: 'x' })

    // Both calls start from the same 'inherit' row. Whichever statement
    // order the two interleave in, the note must never end up back at
    // 'inherit' once the syntax-setting call has actually committed: a
    // decision based on a stale read (rather than the live row, re-checked
    // atomically in the UPDATE's WHERE clause) would let this regress.
    const results = await Promise.allSettled([
      updateNote(env.DB, DEV_OWNER, created.id, { format: 'syntax' }),
      updateNote(env.DB, DEV_OWNER, created.id, { format: 'inherit' }),
    ])

    // Setting to a concrete format is unconditionally allowed, whatever the
    // current value, so this call must always succeed.
    expect(results[0].status).toBe('fulfilled')
    // The inherit-targeting call either lands before 'syntax' commits (a
    // harmless no-op, since the note was still 'inherit' at that instant) or
    // after it (rejected with 409, never silently reverting the format).
    if (results[1].status === 'rejected') {
      expect((results[1].reason as { status?: number }).status).toBe(409)
    }

    const row = await env.DB.prepare('SELECT format FROM notes WHERE id = ?')
      .bind(created.id)
      .first<{ format: string }>()
    expect(row?.format).not.toBe('inherit')
    expect(row?.format).toBe('syntax')
  })
})

describe('GET /api/notes list', () => {
  it('orders a pinned note first regardless of recency', async () => {
    const env = createTestEnv()
    const first = await createNote(env, { title: 'first' })
    const second = await createNote(env, { title: 'second' })
    await createNote(env, { title: 'third' })

    const pinResponse = await patchNote(env, first.id, { pinned: true })
    expect(pinResponse.status).toBe(200)

    const response = await call(env, '/api/notes')
    const body = (await response.json()) as NoteListResponse
    expect(body.items[0]?.id).toBe(first.id)
    expect(body.items.some((item) => item.id === second.id)).toBe(true)
  })

  it('covers all notes exactly once via cursor pagination, tie-broken by id when updated_at matches', async () => {
    const env = createTestEnv()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const note = await createNote(env, { title: `note-${i}` })
      ids.push(note.id)
    }

    // Force every row to the same updated_at so pagination can only stay
    // stable and non-overlapping via the id DESC tie-break.
    await env.DB.prepare('UPDATE notes SET updated_at = 1000 WHERE owner = ?').bind(DEV_OWNER).run()

    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 10; page++) {
      const url = cursor ? `/api/notes?limit=2&cursor=${encodeURIComponent(cursor)}` : '/api/notes?limit=2'
      const response = await call(env, url)
      const body = (await response.json()) as NoteListResponse
      seen.push(...body.items.map((item) => item.id))
      cursor = body.nextCursor
      if (!cursor) break
    }

    expect(new Set(seen).size).toBe(ids.length)
    // With pinned and updated_at tied, the combined order across pages must
    // be strictly descending by id; this also implies every id was seen
    // exactly once, since it must equal a permutation of `ids`.
    expect(seen).toEqual([...ids].sort().reverse())
  })

  it('returns 400 for a malformed cursor', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'x' })

    const response = await call(env, '/api/notes?cursor=not-a-cursor')
    expect(response.status).toBe(400)
  })

  it('clamps a fractional limit to at least 1 rather than truncating to 0', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'x' })

    const response = await call(env, '/api/notes?limit=0.5')
    expect(response.status).toBe(200)
    const body = (await response.json()) as NoteListResponse
    expect(body.items.length).toBeGreaterThanOrEqual(1)
  })
})
