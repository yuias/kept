import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { BODY_MAX_BYTES, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../../shared/limits'
import type { CreateNoteInput, Note, NoteFormat, NoteListResponse, NoteView, UpdateNoteInput } from '../../shared/types'
import { requireIdentity } from '../auth'
import { ownerOf, readJson, type HonoEnv } from '../http'
import { isValidId } from '../id'
import { createNote, getNote, listNotes, updateNote } from '../notes-repo'

export const notesRoutes = new Hono<HonoEnv>()

const VIEWS: readonly NoteView[] = ['notes', 'archive', 'trash', 'all']

function isNoteView(value: string | null): value is NoteView {
  return value !== null && (VIEWS as readonly string[]).includes(value)
}

function parseLimit(value: string | null): number {
  const parsed = Number(value)
  if (!value || !Number.isFinite(parsed) || parsed <= 0) return PAGE_SIZE_DEFAULT
  return Math.min(Math.max(Math.trunc(parsed), 1), PAGE_SIZE_MAX)
}

/** Unknown ids and bad id formats are indistinguishable from "not found". */
function requireNoteId(id: string | undefined): string {
  if (!id || !isValidId(id)) throw new HTTPException(404, { message: 'note not found' })
  return id
}

// Generous relative to BODY_MAX_BYTES: JSON escaping, the title, and the rest
// of the envelope can multiply the wire size, but this still catches a body
// that has no hope of passing `validateBodyBytes` well before it is parsed.
const MAX_REQUEST_BYTES = BODY_MAX_BYTES * 6 + 64 * 1024

/** Rejects an oversized body by its declared length, before `readJson` parses it. */
function checkContentLength(request: Request): void {
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    throw new HTTPException(413, { message: 'request body is too large' })
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HTTPException(400, { message: 'body must be a JSON object' })
  }
  return value as Record<string, unknown>
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

function requireOptionalBoolean(raw: Record<string, unknown>, key: string): boolean | undefined {
  if (!(key in raw)) return undefined
  if (typeof raw[key] !== 'boolean') throw new HTTPException(400, { message: `${key} must be a boolean` })
  return raw[key] as boolean
}

function toCreateInput(raw: Record<string, unknown>): CreateNoteInput {
  const input: CreateNoteInput = {}
  const title = requireOptionalString(raw, 'title')
  if (title !== undefined) input.title = title
  const body = requireOptionalString(raw, 'body')
  if (body !== undefined) input.body = body
  const folderId = requireOptionalNullableString(raw, 'folderId')
  if (folderId !== undefined) input.folderId = folderId
  return input
}

function toUpdateInput(raw: Record<string, unknown>): UpdateNoteInput {
  const input: UpdateNoteInput = {}
  const title = requireOptionalString(raw, 'title')
  if (title !== undefined) input.title = title
  const body = requireOptionalString(raw, 'body')
  if (body !== undefined) input.body = body
  // Validity of `format` (beyond being a string) is checked in the repo,
  // where the 409 format-lock decision also happens.
  const format = requireOptionalString(raw, 'format')
  if (format !== undefined) input.format = format as NoteFormat
  const folderId = requireOptionalNullableString(raw, 'folderId')
  if (folderId !== undefined) input.folderId = folderId
  const pinned = requireOptionalBoolean(raw, 'pinned')
  if (pinned !== undefined) input.pinned = pinned
  const archived = requireOptionalBoolean(raw, 'archived')
  if (archived !== undefined) input.archived = archived
  return input
}

notesRoutes.get('/api/notes', requireIdentity, async (c) => {
  const owner = ownerOf(c)
  const url = new URL(c.req.url)

  const viewParam = url.searchParams.get('view')
  const view = isNoteView(viewParam) ? viewParam : 'notes'

  const folderParam = url.searchParams.get('folder')
  const folderId = folderParam === null ? undefined : folderParam === 'root' ? null : folderParam

  const result = await listNotes(c.env.DB, owner, {
    view,
    folderId,
    cursor: url.searchParams.get('cursor'),
    limit: parseLimit(url.searchParams.get('limit')),
  })

  const body: NoteListResponse = result
  return c.json(body)
})

notesRoutes.post('/api/notes', requireIdentity, async (c) => {
  checkContentLength(c.req.raw)
  const owner = ownerOf(c)
  const input = toCreateInput(asObject(await readJson(c.req.raw)))
  const note = await createNote(c.env.DB, owner, input)
  return c.json(note satisfies Note, 201)
})

notesRoutes.get('/api/notes/:id', requireIdentity, async (c) => {
  const owner = ownerOf(c)
  const id = requireNoteId(c.req.param('id'))
  const note = await getNote(c.env.DB, owner, id)
  if (!note) throw new HTTPException(404, { message: 'note not found' })
  return c.json(note)
})

notesRoutes.patch('/api/notes/:id', requireIdentity, async (c) => {
  checkContentLength(c.req.raw)
  const owner = ownerOf(c)
  const id = requireNoteId(c.req.param('id'))
  const input = toUpdateInput(asObject(await readJson(c.req.raw)))
  const note = await updateNote(c.env.DB, owner, id, input)
  if (!note) throw new HTTPException(404, { message: 'note not found' })
  return c.json(note)
})
