import { HTTPException } from 'hono/http-exception'
import { isNoteFormat } from '../shared/format'
import { BODY_MAX_BYTES, PREVIEW_CHARS, TITLE_MAX_CHARS } from '../shared/limits'
import { markdownToPlain } from '../shared/plaintext'
import type { CreateNoteInput, Note, NoteFormat, NoteSummary, NoteView, UpdateNoteInput } from '../shared/types'
import { ApiException } from './http'
import { generateId } from './id'

interface NoteRow {
  id: string
  folder_id: string | null
  title: string
  body: string
  body_plain: string
  summary: string | null
  format: NoteFormat
  pinned: number
  archived: number
  trashed_at: number | null
  created_at: number
  updated_at: number
}

interface NoteListRow {
  id: string
  folder_id: string | null
  title: string
  format: NoteFormat
  pinned: number
  archived: number
  trashed_at: number | null
  created_at: number
  updated_at: number
  preview: string
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    summary: row.summary,
    format: row.format,
    folderId: row.folder_id,
    labels: [], // labels are not stored yet
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    trashedAt: row.trashed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toNoteSummary(row: NoteListRow): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    preview: row.preview,
    format: row.format,
    folderId: row.folder_id,
    labels: [], // labels are not stored yet
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    trashedAt: row.trashed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validateTitle(title: string): void {
  if (title.length > TITLE_MAX_CHARS) {
    throw new HTTPException(400, { message: `title must be at most ${TITLE_MAX_CHARS} characters` })
  }
}

function validateBodyBytes(body: string): void {
  if (new TextEncoder().encode(body).length > BODY_MAX_BYTES) {
    throw new HTTPException(413, { message: `body must be at most ${BODY_MAX_BYTES} bytes` })
  }
}

/**
 * The `folder_id` foreign key only references `folders(id)`, not
 * `(owner, id)`, so D1 cannot stop a note from pointing at another owner's
 * folder. This owner-scoped lookup is what actually enforces it.
 */
async function folderExists(db: D1Database, owner: string, folderId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM folders WHERE id = ? AND owner = ?').bind(folderId, owner).first()
  return row !== null
}

async function requireOwnedFolder(db: D1Database, owner: string, folderId: string): Promise<void> {
  if (!(await folderExists(db, owner, folderId))) {
    throw new ApiException(400, 'folder_not_found', 'folder not found')
  }
}

export async function getNote(db: D1Database, owner: string, id: string): Promise<Note | null> {
  const row = await db.prepare('SELECT * FROM notes WHERE id = ? AND owner = ?').bind(id, owner).first<NoteRow>()
  return row ? toNote(row) : null
}

export async function createNote(db: D1Database, owner: string, input: CreateNoteInput): Promise<Note> {
  const title = input.title ?? ''
  const body = input.body ?? ''
  validateTitle(title)
  validateBodyBytes(body)

  let folderId: string | null = null
  if (input.folderId !== undefined && input.folderId !== null) {
    await requireOwnedFolder(db, owner, input.folderId)
    folderId = input.folderId
  }

  const id = generateId()
  const now = Date.now()
  const bodyPlain = markdownToPlain(body)

  await db
    .prepare(
      `INSERT INTO notes (id, owner, folder_id, title, body, body_plain, format, pinned, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'inherit', 0, 0, ?, ?)`,
    )
    .bind(id, owner, folderId, title, body, bodyPlain, now, now)
    .run()

  return {
    id,
    title,
    body,
    summary: null,
    format: 'inherit',
    folderId,
    labels: [],
    pinned: false,
    archived: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export async function updateNote(
  db: D1Database,
  owner: string,
  id: string,
  input: UpdateNoteInput,
): Promise<Note | null> {
  // Only checked for existence (404), never read for its column values: a
  // decision built on this row would go stale under an overlapping PATCH, so
  // every actual decision below is either derived from `input` alone or
  // re-checked live inside the UPDATE's own WHERE clause.
  const exists = await db.prepare('SELECT 1 FROM notes WHERE id = ? AND owner = ?').bind(id, owner).first()
  if (!exists) return null

  if (input.pinned === true && input.archived === true) {
    throw new HTTPException(400, { message: 'a note cannot be pinned and archived at the same time' })
  }

  if (input.title !== undefined) validateTitle(input.title)
  if (input.body !== undefined) validateBodyBytes(input.body)
  if (input.format !== undefined && !isNoteFormat(input.format)) {
    throw new HTTPException(400, { message: 'format must be one of inherit, formatted, syntax' })
  }

  if (input.folderId !== undefined && input.folderId !== null) {
    await requireOwnedFolder(db, owner, input.folderId)
  }

  const setClauses: string[] = []
  const setBindings: unknown[] = []
  let contentChanged = false

  if (input.title !== undefined) {
    setClauses.push('title = ?')
    setBindings.push(input.title)
    contentChanged = true
  }
  if (input.body !== undefined) {
    setClauses.push('body = ?', 'body_plain = ?')
    setBindings.push(input.body, markdownToPlain(input.body))
    contentChanged = true
  }
  if (input.folderId !== undefined) {
    setClauses.push('folder_id = ?')
    setBindings.push(input.folderId)
    contentChanged = true
  }

  // The lock (a note may never go back to 'inherit' once concrete) is
  // enforced by the WHERE clause below, against the live row, not against
  // `input` or any prior read.
  let formatTarget: NoteFormat | undefined
  if (input.format !== undefined) {
    setClauses.push('format = ?')
    setBindings.push(input.format)
    formatTarget = input.format
    contentChanged = true
  }

  // Archive first, then pin: archiving clears pinned, and pinning an
  // archived note unarchives it. Derived purely from `input`, with no read
  // of the current pinned/archived columns, so this cannot lose a concurrent
  // write to either one.
  let setArchived: 0 | 1 | undefined
  let setPinned: 0 | 1 | undefined
  if (input.archived !== undefined) {
    setArchived = input.archived ? 1 : 0
    if (input.archived) setPinned = 0
  }
  if (input.pinned !== undefined) {
    setPinned = input.pinned ? 1 : 0
    if (input.pinned) setArchived = 0
  }
  if (setArchived !== undefined) {
    setClauses.push('archived = ?')
    setBindings.push(setArchived)
  }
  if (setPinned !== undefined) {
    setClauses.push('pinned = ?')
    setBindings.push(setPinned)
  }

  // Pin/archive/trash/restore leave updated_at alone; only content-shaped
  // changes bump it.
  if (contentChanged) {
    setClauses.push('updated_at = ?')
    setBindings.push(Date.now())
  }

  if (setClauses.length === 0) {
    // Nothing to write, so there is no write to gate: a plain read of the
    // live trashed status is enough to decide whether to report the 409.
    const row = await db
      .prepare('SELECT trashed_at FROM notes WHERE id = ? AND owner = ?')
      .bind(id, owner)
      .first<{ trashed_at: number | null }>()
    if (!row) return null
    if (row.trashed_at !== null) {
      throw new ApiException(409, 'note_trashed', 'cannot update a trashed note')
    }
    return getNote(db, owner, id)
  }

  // A trashed note is read-only via PATCH, whatever fields are being set, so
  // this is enforced live in the WHERE too, alongside the format lock.
  let where = 'id = ? AND owner = ? AND trashed_at IS NULL'
  const whereBindings: unknown[] = [id, owner]
  if (formatTarget !== undefined) {
    where += " AND NOT (format <> 'inherit' AND ? = 'inherit')"
    whereBindings.push(formatTarget)
  }

  const result = await db
    .prepare(`UPDATE notes SET ${setClauses.join(', ')} WHERE ${where}`)
    .bind(...setBindings, ...whereBindings)
    .run()

  if ((result.meta.changes ?? 0) === 0) {
    // The UPDATE's WHERE is what actually enforced the invariants; this
    // follow-up read only classifies which one failed, for the error code.
    const row = await db
      .prepare('SELECT trashed_at, format FROM notes WHERE id = ? AND owner = ?')
      .bind(id, owner)
      .first<{ trashed_at: number | null; format: NoteFormat }>()
    if (!row) return null
    if (row.trashed_at !== null) {
      throw new ApiException(409, 'note_trashed', 'cannot update a trashed note')
    }
    if (formatTarget !== undefined) {
      throw new ApiException(409, 'format_locked', 'a note cannot go back to inherit once it has a concrete format')
    }
  }

  return getNote(db, owner, id)
}

export async function trashNote(db: D1Database, owner: string, id: string): Promise<Note | null> {
  const result = await db
    .prepare('UPDATE notes SET trashed_at = ? WHERE id = ? AND owner = ? AND trashed_at IS NULL')
    .bind(Date.now(), id, owner)
    .run()
  if ((result.meta.changes ?? 0) === 0) {
    // Idempotent: trashing an already-trashed note is a no-op, not an error.
    const exists = await db.prepare('SELECT 1 FROM notes WHERE id = ? AND owner = ?').bind(id, owner).first()
    if (!exists) return null
  }
  return getNote(db, owner, id)
}

export async function restoreNote(db: D1Database, owner: string, id: string): Promise<Note | null> {
  const result = await db
    .prepare('UPDATE notes SET trashed_at = NULL WHERE id = ? AND owner = ?')
    .bind(id, owner)
    .run()
  if ((result.meta.changes ?? 0) === 0) return null
  return getNote(db, owner, id)
}

export type DeleteNoteResult = 'deleted' | 'not_found' | 'not_trashed'

export async function deleteNoteForever(db: D1Database, owner: string, id: string): Promise<DeleteNoteResult> {
  // Only checked for existence, to tell 404 apart from 409; the trashed
  // invariant itself is enforced live in the DELETE's own WHERE clause.
  const exists = await db.prepare('SELECT 1 FROM notes WHERE id = ? AND owner = ?').bind(id, owner).first()
  if (!exists) return 'not_found'

  const result = await db
    .prepare('DELETE FROM notes WHERE id = ? AND owner = ? AND trashed_at IS NOT NULL')
    .bind(id, owner)
    .run()
  return (result.meta.changes ?? 0) > 0 ? 'deleted' : 'not_trashed'
}

export async function emptyTrash(db: D1Database, owner: string): Promise<void> {
  await db.prepare('DELETE FROM notes WHERE owner = ? AND trashed_at IS NOT NULL').bind(owner).run()
}

function viewWhere(view: NoteView): string {
  switch (view) {
    case 'notes':
      return 'archived = 0 AND trashed_at IS NULL'
    case 'archive':
      return 'archived = 1 AND trashed_at IS NULL'
    case 'trash':
      return 'trashed_at IS NOT NULL'
    case 'all':
      return 'trashed_at IS NULL'
  }
}

// Matches the `${pinned}.${updatedAt}.${id}` encoding exactly: a single 0/1,
// a run of plain digits (no leading '-', hex, or exponent form), and a
// 12-char base62 id. Anything else is rejected before it reaches `Number()`.
const CURSOR_PATTERN = /^[01]\.\d{1,15}\.[0-9A-Za-z]{12}$/

function decodeCursor(cursor: string): { pinned: number; updatedAt: number; id: string } | null {
  if (!CURSOR_PATTERN.test(cursor)) return null

  // The regex above already guarantees exactly three '.'-separated parts.
  const [pinnedPart, updatedAtPart, id] = cursor.split('.') as [string, string, string]
  return { pinned: Number(pinnedPart), updatedAt: Number(updatedAtPart), id }
}

export interface ListNotesOptions {
  view: NoteView
  /** `undefined` = no folder filter; `null` = root (`folder_id IS NULL`); otherwise a specific folder id. */
  folderId?: string | null
  cursor: string | null
  limit: number
}

export interface ListNotesResult {
  items: NoteSummary[]
  nextCursor: string | null
}

export async function listNotes(db: D1Database, owner: string, options: ListNotesOptions): Promise<ListNotesResult> {
  const conditions = ['owner = ?', viewWhere(options.view)]
  const bindings: unknown[] = [owner]

  if (options.folderId === null) {
    conditions.push('folder_id IS NULL')
  } else if (options.folderId !== undefined) {
    conditions.push('folder_id = ?')
    bindings.push(options.folderId)
  }

  if (options.cursor) {
    const decoded = decodeCursor(options.cursor)
    if (!decoded) throw new HTTPException(400, { message: 'malformed cursor' })
    // All three sort columns are DESC, so a plain row-value "<" captures the
    // whole keyset condition in one shot.
    conditions.push('(pinned, updated_at, id) < (?, ?, ?)')
    bindings.push(decoded.pinned, decoded.updatedAt, decoded.id)
  }

  // Fetch one extra row to detect whether another page exists.
  bindings.push(options.limit + 1)

  const sql = `SELECT id, folder_id, title, format, pinned, archived, trashed_at, created_at, updated_at,
      substr(body_plain, 1, ${PREVIEW_CHARS}) AS preview
    FROM notes
    WHERE ${conditions.join(' AND ')}
    ORDER BY pinned DESC, updated_at DESC, id DESC
    LIMIT ?`

  const { results } = await db
    .prepare(sql)
    .bind(...bindings)
    .all<NoteListRow>()

  const rows = results ?? []
  const hasMore = rows.length > options.limit
  const page = hasMore ? rows.slice(0, options.limit) : rows
  const last = page[page.length - 1]

  return {
    items: page.map(toNoteSummary),
    nextCursor: hasMore && last ? `${last.pinned}.${last.updated_at}.${last.id}` : null,
  }
}
