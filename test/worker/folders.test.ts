import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, Folder, Note, NoteListResponse } from '../../src/shared/types'
import { generateId } from '../../src/worker/id'
import { call, createTestEnv } from '../support/env'

const OTHER_OWNER = 'other@example.com'

function createFolder(env: Parameters<typeof call>[0], body: Record<string, unknown>): Promise<Response> {
  return call(env, '/api/folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patchFolder(env: Parameters<typeof call>[0], id: string, body: Record<string, unknown>): Promise<Response> {
  return call(env, `/api/folders/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteFolder(env: Parameters<typeof call>[0], id: string): Promise<Response> {
  return call(env, `/api/folders/${id}`, { method: 'DELETE' })
}

async function createFolderOk(
  env: Parameters<typeof call>[0],
  name: string,
  parentId: string | null = null,
): Promise<Folder> {
  const response = await createFolder(env, { name, parentId })
  expect(response.status).toBe(201)
  return (await response.json()) as Folder
}

/** Inserts a folder row directly, bypassing the API, to simulate another owner's data. */
async function insertFolder(
  env: Parameters<typeof call>[0],
  owner: string,
  parentId: string | null = null,
): Promise<string> {
  const id = generateId()
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO folders (id, owner, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
  )
    .bind(id, owner, parentId, 'Folder', now, now)
    .run()
  return id
}

async function createNote(env: Parameters<typeof call>[0], body: Record<string, unknown> = {}): Promise<Note> {
  const response = await call(env, '/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as Note
}

describe('POST /api/folders', () => {
  it('creates a chain of 8 nested folders, and rejects a 9th level with 409 folder_too_deep', async () => {
    const env = createTestEnv()
    let parentId: string | null = null
    for (let depth = 1; depth <= 8; depth++) {
      const folder = await createFolderOk(env, `depth-${depth}`, parentId)
      parentId = folder.id
    }

    const response = await createFolder(env, { name: 'too-deep', parentId })
    expect(response.status).toBe(409)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('folder_too_deep')
  })

  it('rejects a parentId belonging to another owner with 400 folder_not_found', async () => {
    const env = createTestEnv()
    const otherFolderId = await insertFolder(env, OTHER_OWNER)

    const response = await createFolder(env, { name: 'x', parentId: otherFolderId })
    expect(response.status).toBe(400)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('folder_not_found')
  })
})

describe('PATCH /api/folders/:id', () => {
  it('rejects moving a folder onto its own child with 409 folder_cycle', async () => {
    const env = createTestEnv()
    const parent = await createFolderOk(env, 'parent')
    const child = await createFolderOk(env, 'child', parent.id)

    const response = await patchFolder(env, parent.id, { parentId: child.id })
    expect(response.status).toBe(409)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('folder_cycle')
  })

  it('rejects moving a height-3 subtree under a depth-6 folder with 409 folder_too_deep', async () => {
    const env = createTestEnv()

    // A depth-6 chain to move the subtree under.
    let parentId: string | null = null
    for (let depth = 1; depth <= 6; depth++) {
      const folder = await createFolderOk(env, `chain-${depth}`, parentId)
      parentId = folder.id
    }
    const targetParent = parentId

    // A separate height-3 subtree (root -> mid -> leaf), moved as a whole by
    // moving its root.
    const subtreeRoot = await createFolderOk(env, 'subtree-root')
    const subtreeMid = await createFolderOk(env, 'subtree-mid', subtreeRoot.id)
    await createFolderOk(env, 'subtree-leaf', subtreeMid.id)

    const response = await patchFolder(env, subtreeRoot.id, { parentId: targetParent })
    expect(response.status).toBe(409)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('folder_too_deep')
  })

  it('rejects moving under another owner\'s folder with 400 folder_not_found', async () => {
    const env = createTestEnv()
    const folder = await createFolderOk(env, 'mine')
    const otherFolderId = await insertFolder(env, OTHER_OWNER)

    const response = await patchFolder(env, folder.id, { parentId: otherFolderId })
    expect(response.status).toBe(400)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('folder_not_found')
  })

  it('reports a folder owned by another user as 404', async () => {
    const env = createTestEnv()
    const otherFolderId = await insertFolder(env, OTHER_OWNER)

    const response = await patchFolder(env, otherFolderId, { name: 'renamed' })
    expect(response.status).toBe(404)
  })
})

describe('DELETE /api/folders/:id', () => {
  it('moves child folders and notes of a deleted middle folder up to its parent', async () => {
    const env = createTestEnv()
    const root = await createFolderOk(env, 'root')
    const middle = await createFolderOk(env, 'middle', root.id)
    const leaf = await createFolderOk(env, 'leaf', middle.id)
    const note = await createNote(env, { title: 'x', folderId: middle.id })

    const response = await deleteFolder(env, middle.id)
    expect(response.status).toBe(204)

    const leafResponse = await call(env, '/api/folders')
    const folders = (await leafResponse.json()) as Folder[]
    expect(folders.map((f) => f.id)).not.toContain(middle.id)
    const movedLeaf = folders.find((f) => f.id === leaf.id)
    expect(movedLeaf?.parentId).toBe(root.id)

    const noteResponse = await call(env, `/api/notes/${note.id}`)
    const movedNote = (await noteResponse.json()) as Note
    expect(movedNote.folderId).toBe(root.id)
  })

  it('moves children and notes to root (null) when deleting a root-level folder', async () => {
    const env = createTestEnv()
    const root = await createFolderOk(env, 'root')
    const child = await createFolderOk(env, 'child', root.id)
    const note = await createNote(env, { title: 'x', folderId: root.id })

    const response = await deleteFolder(env, root.id)
    expect(response.status).toBe(204)

    const folders = (await (await call(env, '/api/folders')).json()) as Folder[]
    const movedChild = folders.find((f) => f.id === child.id)
    expect(movedChild?.parentId).toBeNull()

    const movedNote = (await (await call(env, `/api/notes/${note.id}`)).json()) as Note
    expect(movedNote.folderId).toBeNull()
  })

  it('reports a folder owned by another user as 404', async () => {
    const env = createTestEnv()
    const otherFolderId = await insertFolder(env, OTHER_OWNER)

    const response = await deleteFolder(env, otherFolderId)
    expect(response.status).toBe(404)
  })
})

describe('GET /api/notes folder filters', () => {
  it('filters notes by folder id, and by folder=root', async () => {
    const env = createTestEnv()
    const folder = await createFolderOk(env, 'folder')
    const inFolder = await createNote(env, { title: 'in', folderId: folder.id })
    const atRoot = await createNote(env, { title: 'root' })

    const folderResponse = await call(env, `/api/notes?folder=${folder.id}`)
    const folderBody = (await folderResponse.json()) as NoteListResponse
    expect(folderBody.items.map((item) => item.id)).toEqual([inFolder.id])

    const rootResponse = await call(env, '/api/notes?folder=root')
    const rootBody = (await rootResponse.json()) as NoteListResponse
    expect(rootBody.items.map((item) => item.id)).toEqual([atRoot.id])
  })
})
