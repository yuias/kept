import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/types'
import type { AppSettings, ApiErrorBody, Note, NoteListResponse } from '../../src/shared/types'
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

function restoreNote(env: Parameters<typeof call>[0], id: string): Promise<Response> {
  return call(env, `/api/notes/${id}/restore`, { method: 'POST' })
}

function deleteNote(env: Parameters<typeof call>[0], id: string): Promise<Response> {
  return call(env, `/api/notes/${id}`, { method: 'DELETE' })
}

async function listView(env: Parameters<typeof call>[0], view: string): Promise<NoteListResponse> {
  const response = await call(env, `/api/notes?view=${view}`)
  return (await response.json()) as NoteListResponse
}

describe('trash and restore', () => {
  it('moves a note through trash -> list(trash) -> restore -> list(notes)', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })

    const trashResponse = await trashNote(env, note.id)
    expect(trashResponse.status).toBe(200)
    const trashed = (await trashResponse.json()) as Note
    expect(trashed.trashedAt).not.toBeNull()

    const notesAfterTrash = await listView(env, 'notes')
    expect(notesAfterTrash.items.map((item) => item.id)).not.toContain(note.id)
    const trashList = await listView(env, 'trash')
    expect(trashList.items.map((item) => item.id)).toContain(note.id)

    const restoreResponse = await restoreNote(env, note.id)
    expect(restoreResponse.status).toBe(200)
    const restored = (await restoreResponse.json()) as Note
    expect(restored.trashedAt).toBeNull()

    const notesAfterRestore = await listView(env, 'notes')
    expect(notesAfterRestore.items.map((item) => item.id)).toContain(note.id)
    const trashListAfterRestore = await listView(env, 'trash')
    expect(trashListAfterRestore.items.map((item) => item.id)).not.toContain(note.id)
  })

  it('leaves updated_at unchanged after pin, format, lock, trash and restore', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })

    // Backdate so a same-millisecond pin/trash/restore in a fast test run
    // cannot pass by accident: a real bump would be strictly greater than
    // this, not merely equal by coincidence.
    await env.DB.prepare('UPDATE notes SET updated_at = 1000 WHERE id = ?').bind(note.id).run()

    const pinResponse = await patchNote(env, note.id, { pinned: true })
    expect(pinResponse.status).toBe(200)
    expect(((await pinResponse.json()) as Note).updatedAt).toBe(1000)

    const formatResponse = await patchNote(env, note.id, { format: 'syntax' })
    expect(formatResponse.status).toBe(200)
    const formatted = (await formatResponse.json()) as Note
    expect(formatted.format).toBe('syntax')
    expect(formatted.updatedAt).toBe(1000)

    const lockResponse = await patchNote(env, note.id, { locked: true })
    expect(lockResponse.status).toBe(200)
    const locked = (await lockResponse.json()) as Note
    expect(locked.locked).toBe(true)
    expect(locked.updatedAt).toBe(1000)

    const unlockResponse = await patchNote(env, note.id, { locked: false })
    expect(unlockResponse.status).toBe(200)
    const unlocked = (await unlockResponse.json()) as Note
    expect(unlocked.locked).toBe(false)
    expect(unlocked.updatedAt).toBe(1000)

    const trashResponse = await trashNote(env, note.id)
    expect(trashResponse.status).toBe(200)
    expect(((await trashResponse.json()) as Note).updatedAt).toBe(1000)

    const restoreResponse = await restoreNote(env, note.id)
    expect(restoreResponse.status).toBe(200)
    expect(((await restoreResponse.json()) as Note).updatedAt).toBe(1000)
  })

  it('still bumps updated_at when a format change is combined with a title change', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })
    await env.DB.prepare('UPDATE notes SET updated_at = 1000 WHERE id = ?').bind(note.id).run()

    const response = await patchNote(env, note.id, { format: 'formatted', title: 'y' })
    expect(response.status).toBe(200)
    expect(((await response.json()) as Note).updatedAt).toBeGreaterThan(1000)
  })

  it('returns 409 note_trashed when PATCHing a trashed note', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })
    await trashNote(env, note.id)

    const response = await patchNote(env, note.id, { title: 'y' })
    expect(response.status).toBe(409)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('note_trashed')
  })
})

describe('note lock', () => {
  it('starts unlocked and reports the lock from both GET and the list', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })
    expect(note.locked).toBe(false)

    const lockResponse = await patchNote(env, note.id, { locked: true })
    expect(lockResponse.status).toBe(200)

    const getResponse = await call(env, `/api/notes/${note.id}`)
    expect(((await getResponse.json()) as Note).locked).toBe(true)
    const listed = (await listView(env, 'notes')).items.find((item) => item.id === note.id)
    expect(listed?.locked).toBe(true)
  })

  it('rejects a non-boolean locked value with 400', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })

    const response = await patchNote(env, note.id, { locked: 'yes' })
    expect(response.status).toBe(400)
  })

  it('does not enforce the lock on body edits', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x', body: '- [ ] done' })
    await env.DB.prepare('UPDATE notes SET updated_at = 1000 WHERE id = ?').bind(note.id).run()
    await patchNote(env, note.id, { locked: true })

    const response = await patchNote(env, note.id, { body: '- [x] done' })
    expect(response.status).toBe(200)
    const updated = (await response.json()) as Note
    expect(updated.body).toBe('- [x] done')
    expect(updated.updatedAt).toBeGreaterThan(1000)
    expect(updated.locked).toBe(true)
  })

  it('rejects unlocking a trashed note and keeps the lock across restore', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })
    await patchNote(env, note.id, { locked: true })
    await trashNote(env, note.id)

    const response = await patchNote(env, note.id, { locked: false })
    expect(response.status).toBe(409)
    expect(((await response.json()) as ApiErrorBody).error).toBe('note_trashed')

    const restored = (await (await restoreNote(env, note.id)).json()) as Note
    expect(restored.locked).toBe(true)
  })
})

describe('DELETE /api/notes/:id', () => {
  it('refuses to delete a non-trashed note with 409', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })

    const response = await deleteNote(env, note.id)
    expect(response.status).toBe(409)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('note_not_trashed')
  })

  it('deletes a trashed note with 204, then reports it as 404', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })
    await trashNote(env, note.id)

    const response = await deleteNote(env, note.id)
    expect(response.status).toBe(204)

    const getResponse = await call(env, `/api/notes/${note.id}`)
    expect(getResponse.status).toBe(404)
  })
})

describe('DELETE /api/trash', () => {
  it('removes only trashed notes', async () => {
    const env = createTestEnv()
    const kept = await createNote(env, { title: 'kept' })
    const trashed = await createNote(env, { title: 'trashed' })
    await trashNote(env, trashed.id)

    const response = await call(env, '/api/trash', { method: 'DELETE' })
    expect(response.status).toBe(204)

    const keptResponse = await call(env, `/api/notes/${kept.id}`)
    expect(keptResponse.status).toBe(200)
    const trashedResponse = await call(env, `/api/notes/${trashed.id}`)
    expect(trashedResponse.status).toBe(404)
  })
})

describe('archive and pin interaction', () => {
  it('clears pinned when archiving', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })
    await patchNote(env, note.id, { pinned: true })

    const response = await patchNote(env, note.id, { archived: true })
    expect(response.status).toBe(200)
    const archived = (await response.json()) as Note
    expect(archived.archived).toBe(true)
    expect(archived.pinned).toBe(false)
  })

  it('unarchives a note when pinning it', async () => {
    const env = createTestEnv()
    const note = await createNote(env, { title: 'x' })
    await patchNote(env, note.id, { archived: true })

    const response = await patchNote(env, note.id, { pinned: true })
    expect(response.status).toBe(200)
    const pinned = (await response.json()) as Note
    expect(pinned.pinned).toBe(true)
    expect(pinned.archived).toBe(false)
  })
})

function putSettings(env: Parameters<typeof call>[0], body: Record<string, unknown>): Promise<Response> {
  return call(env, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('settings', () => {
  it('GET returns the defaults when nothing has been saved', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/settings')
    expect(response.status).toBe(200)
    const body = (await response.json()) as AppSettings
    expect(body).toEqual(DEFAULT_SETTINGS)
  })

  it('PUT persists a partial update over the defaults', async () => {
    const env = createTestEnv()
    const putResponse = await call(env, '/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultFormat: 'syntax' }),
    })
    expect(putResponse.status).toBe(200)
    const putBody = (await putResponse.json()) as AppSettings
    expect(putBody.defaultFormat).toBe('syntax')
    expect(putBody.folderSort).toBe(DEFAULT_SETTINGS.folderSort)

    const getResponse = await call(env, '/api/settings')
    const getBody = (await getResponse.json()) as AppSettings
    expect(getBody.defaultFormat).toBe('syntax')
  })

  it('rejects an unknown folderSort value with 400', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folderSort: 'bogus' }),
    })
    expect(response.status).toBe(400)
  })

  it('GET reports the default trash retention when nothing has been saved', async () => {
    const env = createTestEnv()
    const body = (await (await call(env, '/api/settings')).json()) as AppSettings
    expect(body.trashRetentionDays).toBe(30)
  })

  it('PUT stores trashRetentionDays and leaves the other keys alone', async () => {
    const env = createTestEnv()
    const put = await putSettings(env, { trashRetentionDays: 7 })
    expect(put.status).toBe(200)
    const body = (await (await call(env, '/api/settings')).json()) as AppSettings
    expect(body).toEqual({ ...DEFAULT_SETTINGS, trashRetentionDays: 7 })
  })

  it('PUT keeps an explicit null instead of falling back to the default', async () => {
    const env = createTestEnv()
    expect((await putSettings(env, { trashRetentionDays: null })).status).toBe(200)
    const body = (await (await call(env, '/api/settings')).json()) as AppSettings
    expect(body.trashRetentionDays).toBeNull()
  })

  it.each([0, -1, 1.5, '30', 3651])('rejects trashRetentionDays %j with 400', async (value) => {
    const env = createTestEnv()
    expect((await putSettings(env, { trashRetentionDays: value })).status).toBe(400)
    const body = (await (await call(env, '/api/settings')).json()) as AppSettings
    expect(body.trashRetentionDays).toBe(30)
  })

  it('fills in the default retention for a row saved before the key existed', async () => {
    const env = createTestEnv()
    await env.DB.prepare('INSERT INTO settings (owner, data, updated_at) VALUES (?, ?, ?)')
      .bind('dev@localhost', JSON.stringify({ defaultFormat: 'syntax' }), Date.now())
      .run()
    const body = (await (await call(env, '/api/settings')).json()) as AppSettings
    expect(body.defaultFormat).toBe('syntax')
    expect(body.trashRetentionDays).toBe(30)
  })
})
