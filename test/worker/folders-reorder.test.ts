import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, Folder } from '../../src/shared/types'
import { generateId } from '../../src/worker/id'
import { call, createTestEnv } from '../support/env'

type Env = Parameters<typeof call>[0]

const OTHER_OWNER = 'other@example.com'

function reorder(env: Env, body: Record<string, unknown>): Promise<Response> {
  return call(env, '/api/folders/reorder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function createFolderOk(env: Env, name: string, parentId: string | null = null): Promise<Folder> {
  const response = await call(env, '/api/folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, parentId }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as Folder
}

/** Inserts a folder row directly, bypassing the API, to simulate another owner's data. */
async function insertFolder(env: Env, owner: string): Promise<string> {
  const id = generateId()
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO folders (id, owner, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, NULL, ?, 0, ?, ?)',
  )
    .bind(id, owner, 'Folder', now, now)
    .run()
  return id
}

/** Sort orders by id, read straight from D1 without an owner filter. */
async function sortOrders(env: Env): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare('SELECT id, sort_order FROM folders').all<{
    id: string
    sort_order: number
  }>()
  return Object.fromEntries(results.map((row) => [row.id, row.sort_order]))
}

async function expectError(response: Response, status: number, error: string): Promise<void> {
  expect(response.status).toBe(status)
  expect(((await response.json()) as ApiErrorBody).error).toBe(error)
}

describe('POST /api/folders/reorder', () => {
  it('persists the new order for root siblings (parentId null)', async () => {
    const env = createTestEnv()
    const a = await createFolderOk(env, 'a')
    const b = await createFolderOk(env, 'b')
    const c = await createFolderOk(env, 'c')

    const response = await reorder(env, { parentId: null, ids: [c.id, a.id, b.id] })
    expect(response.status).toBe(204)

    const listed = (await (await call(env, '/api/folders')).json()) as Folder[]
    const order = Object.fromEntries(listed.map((f) => [f.id, f.sortOrder]))
    expect(order).toEqual({ [c.id]: 0, [a.id]: 1, [b.id]: 2 })
  })

  it('reorders only the given parent and leaves other levels untouched', async () => {
    const env = createTestEnv()
    const root = await createFolderOk(env, 'root')
    const x = await createFolderOk(env, 'x', root.id)
    const y = await createFolderOk(env, 'y', root.id)
    const other = await createFolderOk(env, 'other')

    const response = await reorder(env, { parentId: root.id, ids: [y.id, x.id] })
    expect(response.status).toBe(204)

    expect(await sortOrders(env)).toEqual({ [root.id]: 0, [other.id]: 1, [y.id]: 0, [x.id]: 1 })
  })

  it('rejects a missing sibling with 400', async () => {
    const env = createTestEnv()
    const a = await createFolderOk(env, 'a')
    await createFolderOk(env, 'b')

    await expectError(await reorder(env, { parentId: null, ids: [a.id] }), 400, 'bad_request')
  })

  it('rejects an extra id that belongs to another parent with 400', async () => {
    const env = createTestEnv()
    const a = await createFolderOk(env, 'a')
    const child = await createFolderOk(env, 'child', a.id)

    await expectError(await reorder(env, { parentId: null, ids: [a.id, child.id] }), 400, 'bad_request')
  })

  it('rejects a duplicate id with 400 even when the length matches', async () => {
    const env = createTestEnv()
    const a = await createFolderOk(env, 'a')
    await createFolderOk(env, 'b')

    await expectError(await reorder(env, { parentId: null, ids: [a.id, a.id] }), 400, 'bad_request')
  })

  it('rejects malformed bodies with 400', async () => {
    const env = createTestEnv()
    await expectError(await reorder(env, { ids: [] }), 400, 'bad_request')
    await expectError(await reorder(env, { parentId: null }), 400, 'bad_request')
    await expectError(await reorder(env, { parentId: null, ids: [1] }), 400, 'bad_request')
  })

  it('does not change anything when a request is rejected', async () => {
    const env = createTestEnv()
    const a = await createFolderOk(env, 'a')
    const b = await createFolderOk(env, 'b')

    await reorder(env, { parentId: null, ids: [b.id] })
    expect(await sortOrders(env)).toEqual({ [a.id]: 0, [b.id]: 1 })
  })

  it("returns 404 when ids contain another owner's folder, and does not touch it", async () => {
    const env = createTestEnv()
    const a = await createFolderOk(env, 'a')
    const otherId = await insertFolder(env, OTHER_OWNER)

    await expectError(await reorder(env, { parentId: null, ids: [otherId, a.id] }), 404, 'not_found')
    await expectError(await reorder(env, { parentId: null, ids: [otherId] }), 404, 'not_found')
    expect(await sortOrders(env)).toEqual({ [a.id]: 0, [otherId]: 0 })
  })

  it("returns 404 when parentId is another owner's folder", async () => {
    const env = createTestEnv()
    const otherId = await insertFolder(env, OTHER_OWNER)

    await expectError(await reorder(env, { parentId: otherId, ids: [] }), 404, 'not_found')
  })

  it('does not count another owner\'s root folders as siblings', async () => {
    const env = createTestEnv()
    const a = await createFolderOk(env, 'a')
    const b = await createFolderOk(env, 'b')
    const otherId = await insertFolder(env, OTHER_OWNER)

    const response = await reorder(env, { parentId: null, ids: [b.id, a.id] })
    expect(response.status).toBe(204)
    expect(await sortOrders(env)).toEqual({ [b.id]: 0, [a.id]: 1, [otherId]: 0 })
  })
})
