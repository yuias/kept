import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { CreateFolderInput, Folder, UpdateFolderInput } from '../../shared/types'
import { requireIdentity } from '../auth'
import { createFolder, deleteFolder, listFolders, updateFolder } from '../folders-repo'
import { ownerOf, readJson, type HonoEnv } from '../http'
import { isValidId } from '../id'

export const foldersRoutes = new Hono<HonoEnv>()

// A folder body is just a name and a 12-char id: generous relative to
// FOLDER_NAME_MAX_CHARS, but still catches a body with no hope of validating
// well before it is parsed.
const MAX_REQUEST_BYTES = 16 * 1024

/** Rejects an oversized body by its declared length, before `readJson` parses it. */
function checkContentLength(request: Request): void {
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    throw new HTTPException(413, { message: 'request body is too large' })
  }
}

/** Unknown ids and bad id formats are indistinguishable from "not found". */
function requireFolderId(id: string | undefined): string {
  if (!id || !isValidId(id)) throw new HTTPException(404, { message: 'folder not found' })
  return id
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HTTPException(400, { message: 'body must be a JSON object' })
  }
  return value as Record<string, unknown>
}

function requireNullableString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new HTTPException(400, { message: `${key} must be a string or null` })
  return value
}

function requireOptionalString(raw: Record<string, unknown>, key: string): string | undefined {
  if (!(key in raw)) return undefined
  if (typeof raw[key] !== 'string') throw new HTTPException(400, { message: `${key} must be a string` })
  return raw[key] as string
}

function requireOptionalNullableString(raw: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in raw)) return undefined
  if (raw[key] === null) return null
  if (typeof raw[key] !== 'string') throw new HTTPException(400, { message: `${key} must be a string or null` })
  return raw[key] as string
}

function toCreateInput(raw: Record<string, unknown>): CreateFolderInput {
  if (typeof raw.name !== 'string') throw new HTTPException(400, { message: 'name must be a string' })
  return { name: raw.name, parentId: requireNullableString(raw, 'parentId') }
}

function toUpdateInput(raw: Record<string, unknown>): UpdateFolderInput {
  const input: UpdateFolderInput = {}
  const name = requireOptionalString(raw, 'name')
  if (name !== undefined) input.name = name
  const parentId = requireOptionalNullableString(raw, 'parentId')
  if (parentId !== undefined) input.parentId = parentId
  return input
}

foldersRoutes.get('/api/folders', requireIdentity, async (c) => {
  const owner = ownerOf(c)
  const folders = await listFolders(c.env.DB, owner)
  return c.json(folders satisfies Folder[])
})

foldersRoutes.post('/api/folders', requireIdentity, async (c) => {
  checkContentLength(c.req.raw)
  const owner = ownerOf(c)
  const input = toCreateInput(asObject(await readJson(c.req.raw)))
  const folder = await createFolder(c.env.DB, owner, input)
  return c.json(folder satisfies Folder, 201)
})

foldersRoutes.patch('/api/folders/:id', requireIdentity, async (c) => {
  checkContentLength(c.req.raw)
  const owner = ownerOf(c)
  const id = requireFolderId(c.req.param('id'))
  const input = toUpdateInput(asObject(await readJson(c.req.raw)))
  const folder = await updateFolder(c.env.DB, owner, id, input)
  if (!folder) throw new HTTPException(404, { message: 'folder not found' })
  return c.json(folder)
})

foldersRoutes.delete('/api/folders/:id', requireIdentity, async (c) => {
  const owner = ownerOf(c)
  const id = requireFolderId(c.req.param('id'))
  const result = await deleteFolder(c.env.DB, owner, id)
  if (result === 'not_found') throw new HTTPException(404, { message: 'folder not found' })
  return c.body(null, 204)
})
