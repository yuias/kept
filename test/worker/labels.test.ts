import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, LabelCount, Note, NoteListResponse } from '../../src/shared/types'
import { generateId } from '../../src/worker/id'
import { call, createTestEnv } from '../support/env'

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

function trashNote(env: Parameters<typeof call>[0], id: string): Promise<Response> {
  return call(env, `/api/notes/${id}/trash`, { method: 'POST' })
}

async function getLabels(env: Parameters<typeof call>[0]): Promise<LabelCount[]> {
  const response = await call(env, '/api/labels')
  expect(response.status).toBe(200)
  return (await response.json()) as LabelCount[]
}

/** Inserts a label row directly for another owner, bypassing the app's write path entirely. */
async function insertLabel(env: Parameters<typeof call>[0], owner: string, name: string): Promise<string> {
  const id = generateId()
  await env.DB.prepare('INSERT INTO labels (id, owner, name, created_at) VALUES (?, ?, ?, ?)').bind(id, owner, name, Date.now()).run()
  return id
}

async function countLabelRows(env: Parameters<typeof call>[0], owner: string, name: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM labels WHERE owner = ? AND name = ? COLLATE NOCASE')
    .bind(owner, name)
    .first<{ n: number }>()
  return row?.n ?? 0
}

async function countNoteLabelRows(env: Parameters<typeof call>[0], noteId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM note_labels WHERE note_id = ?').bind(noteId).first<{ n: number }>()
  return row?.n ?? 0
}

describe('labels round-trip', () => {
  it('creates a note with labels and returns them sorted case-insensitively on GET', async () => {
    const env = createTestEnv()
    const created = await createNote(env, { title: 'x', labels: ['banana', 'Apple'] })
    expect(created.labels).toEqual(['Apple', 'banana'])

    const getResponse = await call(env, `/api/notes/${created.id}`)
    const fetched = (await getResponse.json()) as Note
    expect(fetched.labels).toEqual(['Apple', 'banana'])
  })

  it('replaces labels on PATCH', async () => {
    const env = createTestEnv()
    const created = await createNote(env, { title: 'x', labels: ['a', 'b'] })

    const response = await patchNote(env, created.id, { labels: ['b', 'c'] })
    expect(response.status).toBe(200)
    const updated = (await response.json()) as Note
    expect(updated.labels).toEqual(['b', 'c'])
  })

  it('normalizes and dedupes labels: "a, A ,b,," -> ["a", "b"]', async () => {
    const env = createTestEnv()
    // The API takes an array, not a comma string, but normalizeLabels applies
    // the same collapsing/dedupe rules regardless of where the array came from.
    const created = await createNote(env, { title: 'x', labels: ['a', ' A ', 'b', '', ''] })
    expect(created.labels).toEqual(['a', 'b'])
  })

  it('rejects a label containing a comma with 400', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', labels: ['a,b'] }),
    })
    expect(response.status).toBe(400)
  })

  it('bumps updated_at when only labels change', async () => {
    const env = createTestEnv()
    const created = await createNote(env, { title: 'x' })
    await env.DB.prepare('UPDATE notes SET updated_at = 1000 WHERE id = ?').bind(created.id).run()

    const response = await patchNote(env, created.id, { labels: ['a'] })
    expect(response.status).toBe(200)
    const updated = (await response.json()) as Note
    expect(updated.updatedAt).toBeGreaterThan(1000)
  })
})

describe('GET /api/notes?label=', () => {
  it('filters case-insensitively', async () => {
    const env = createTestEnv()
    const tagged = await createNote(env, { title: 'tagged', labels: ['Work'] })
    await createNote(env, { title: 'untagged' })

    const response = await call(env, '/api/notes?label=work')
    expect(response.status).toBe(200)
    const body = (await response.json()) as NoteListResponse
    expect(body.items.map((item) => item.id)).toEqual([tagged.id])
  })

  it('normalizes surrounding and inner whitespace in the query param, like a stored name', async () => {
    const env = createTestEnv()
    const tagged = await createNote(env, { title: 'tagged', labels: ['big idea'] })

    const response = await call(env, `/api/notes?label=${encodeURIComponent('  big   idea  ')}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as NoteListResponse
    expect(body.items.map((item) => item.id)).toEqual([tagged.id])
  })

  it('treats an empty (or whitespace-only) label param as no filter at all', async () => {
    const env = createTestEnv()
    const untagged = await createNote(env, { title: 'untagged' })
    const tagged = await createNote(env, { title: 'tagged', labels: ['work'] })

    const emptyResponse = await call(env, '/api/notes?label=')
    expect(emptyResponse.status).toBe(200)
    const emptyBody = (await emptyResponse.json()) as NoteListResponse
    expect(emptyBody.items.map((item) => item.id).sort()).toEqual([tagged.id, untagged.id].sort())

    const blankResponse = await call(env, `/api/notes?label=${encodeURIComponent('   ')}`)
    const blankBody = (await blankResponse.json()) as NoteListResponse
    expect(blankBody.items.map((item) => item.id).sort()).toEqual([tagged.id, untagged.id].sort())
  })
})

describe('GET /api/labels', () => {
  it('counts non-trashed notes only, ordered by name case-insensitively', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'a', labels: ['zebra'] })
    const b = await createNote(env, { title: 'b', labels: ['zebra', 'Apple'] })
    await trashNote(env, b.id)

    const labels = await getLabels(env)
    // "Apple" was only ever attached to the note that got trashed, so it
    // drops out of the non-trashed count entirely (an inner join on notes).
    expect(labels).toEqual([{ name: 'zebra', count: 1 }])
  })

  it('reuses an existing case-insensitive spelling across notes, in both directions', async () => {
    const env = createTestEnv()
    await createNote(env, { title: 'a', labels: ['Work'] })

    const b = await createNote(env, { title: 'b', labels: ['work'] })
    // The response must report the spelling actually stored ("Work"), not
    // the input spelling ("work"), since the two notes share one label row.
    expect(b.labels).toEqual(['Work'])

    const getB = (await (await call(env, `/api/notes/${b.id}`)).json()) as Note
    expect(getB.labels).toEqual(['Work'])

    expect(await getLabels(env)).toEqual([{ name: 'Work', count: 2 }])
  })

  it('removes a label entirely once its only note no longer references it', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x', labels: ['solo'] })
    expect(await getLabels(env)).toEqual([{ name: 'solo', count: 1 }])

    const response = await patchNote(env, note.id, { labels: [] })
    expect(response.status).toBe(200)

    expect(await getLabels(env)).toEqual([])
    expect(await countLabelRows(env, DEV_OWNER, 'solo')).toBe(0)
  })
})

describe('orphan cleanup on permanent delete', () => {
  it('deleteNoteForever removes labels left with no notes', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x', labels: ['only-here'] })
    await trashNote(env, note.id)

    const response = await call(env, `/api/notes/${note.id}`, { method: 'DELETE' })
    expect(response.status).toBe(204)

    expect(await countLabelRows(env, DEV_OWNER, 'only-here')).toBe(0)
  })

  it('DELETE /api/trash (emptyTrash) removes labels left with no notes', async () => {
    const env = createTestEnv()
    const kept = await createNote(env, { title: 'kept', labels: ['shared'] })
    const trashed = await createNote(env, { title: 'trashed', labels: ['shared', 'gone'] })
    await trashNote(env, trashed.id)

    const response = await call(env, '/api/trash', { method: 'DELETE' })
    expect(response.status).toBe(204)

    // "shared" survives because "kept" still references it; "gone" was only
    // ever on the trashed note, so it is now orphaned and removed.
    expect(await countLabelRows(env, DEV_OWNER, 'shared')).toBe(1)
    expect(await countLabelRows(env, DEV_OWNER, 'gone')).toBe(0)
  })
})

describe('cross-owner isolation', () => {
  it('does not attach to or leak another owner\'s same-named label', async () => {
    const env = createTestEnv()
    const otherLabelId = await insertLabel(env, OTHER_OWNER, 'shared-name')

    const created = await createNote(env, { title: 'x', labels: ['shared-name'] })

    // The dev owner's note must be linked to a label row owned by dev, not
    // the other owner's row, even though the names collide case-insensitively.
    const linkedOwner = await env.DB.prepare(
      `SELECT l.owner AS owner FROM note_labels nl JOIN labels l ON l.id = nl.label_id WHERE nl.note_id = ?`,
    )
      .bind(created.id)
      .first<{ owner: string }>()
    expect(linkedOwner?.owner).toBe(DEV_OWNER)

    const labels = await getLabels(env)
    expect(labels).toEqual([{ name: 'shared-name', count: 1 }])

    // The other owner's row is untouched, and never counted or exposed here.
    const otherRow = await env.DB.prepare('SELECT id FROM labels WHERE id = ?').bind(otherLabelId).first()
    expect(otherRow).not.toBeNull()
  })

  it('permanent delete never touches another owner\'s orphaned label', async () => {
    const env = createTestEnv()
    const otherLabelId = await insertLabel(env, OTHER_OWNER, 'other-only')

    const note = await createNote(env, { title: 'x' })
    await trashNote(env, note.id)
    const response = await call(env, `/api/notes/${note.id}`, { method: 'DELETE' })
    expect(response.status).toBe(204)

    const otherRow = await env.DB.prepare('SELECT id FROM labels WHERE id = ?').bind(otherLabelId).first()
    expect(otherRow).not.toBeNull()
  })
})

describe('trashed notes are read-only for labels too', () => {
  it('returns 409 note_trashed and leaves note_labels and labels untouched', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x', labels: ['keep'] })
    await trashNote(env, note.id)
    const before = await countNoteLabelRows(env, note.id)

    const response = await patchNote(env, note.id, { labels: ['other'] })
    expect(response.status).toBe(409)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('note_trashed')

    expect(await countNoteLabelRows(env, note.id)).toBe(before)
    // Proves the trailing orphan cleanup removed the unguarded stray row that
    // the unconditional `INSERT OR IGNORE INTO labels` would otherwise leave.
    expect(await countLabelRows(env, DEV_OWNER, 'other')).toBe(0)
  })

  it('a rejected format-lock change also leaves label writes rolled back', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x', labels: ['keep'] })
    const syntaxResponse = await patchNote(env, note.id, { format: 'syntax' })
    expect(syntaxResponse.status).toBe(200)

    const response = await patchNote(env, note.id, { format: 'inherit', labels: ['other'] })
    expect(response.status).toBe(409)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('format_locked')

    expect(await countNoteLabelRows(env, note.id)).toBe(1)
    const remaining = (await (await call(env, `/api/notes/${note.id}`)).json()) as Note
    expect(remaining.labels).toEqual(['keep'])
    expect(await countLabelRows(env, DEV_OWNER, 'other')).toBe(0)
  })
})
