import { canCreateUnder, checkMove, type FolderLink } from '../shared/folder-tree'
import { FOLDER_NAME_MAX_CHARS } from '../shared/limits'
import type { CreateFolderInput, Folder, UpdateFolderInput } from '../shared/types'
import { ApiException } from './http'
import { generateId } from './id'

interface FolderRow {
  id: string
  parent_id: string | null
  name: string
  sort_order: number
  created_at: number
  updated_at: number
}

function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validateName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > FOLDER_NAME_MAX_CHARS) {
    throw new ApiException(400, 'bad_request', `name must be 1-${FOLDER_NAME_MAX_CHARS} characters`)
  }
  return trimmed
}

/**
 * `folders.parent_id` only references `folders(id)`, not `(owner, id)`, so D1
 * cannot stop a folder from pointing at another owner's folder. Loading only
 * this owner's links up front is what actually enforces ownership, both for
 * `parentId` lookups below and for `checkMove`/`canCreateUnder`, which only
 * ever see this owner's folders.
 */
async function loadFolderLinks(db: D1Database, owner: string): Promise<FolderLink[]> {
  const { results } = await db
    .prepare('SELECT id, parent_id FROM folders WHERE owner = ?')
    .bind(owner)
    .all<{ id: string; parent_id: string | null }>()
  return (results ?? []).map((row) => ({ id: row.id, parentId: row.parent_id }))
}

function requireOwnedParent(links: FolderLink[], parentId: string): void {
  if (!links.some((f) => f.id === parentId)) {
    throw new ApiException(400, 'folder_not_found', 'parent folder not found')
  }
}

async function nextSortOrder(db: D1Database, owner: string, parentId: string | null): Promise<number> {
  const row =
    parentId === null
      ? await db
          .prepare('SELECT MAX(sort_order) AS m FROM folders WHERE owner = ? AND parent_id IS NULL')
          .bind(owner)
          .first<{ m: number | null }>()
      : await db
          .prepare('SELECT MAX(sort_order) AS m FROM folders WHERE owner = ? AND parent_id = ?')
          .bind(owner, parentId)
          .first<{ m: number | null }>()
  return (row?.m ?? -1) + 1
}

export async function getFolder(db: D1Database, owner: string, id: string): Promise<Folder | null> {
  const row = await db.prepare('SELECT * FROM folders WHERE id = ? AND owner = ?').bind(id, owner).first<FolderRow>()
  return row ? toFolder(row) : null
}

export async function listFolders(db: D1Database, owner: string): Promise<Folder[]> {
  const { results } = await db.prepare('SELECT * FROM folders WHERE owner = ?').bind(owner).all<FolderRow>()
  return (results ?? []).map(toFolder)
}

export async function createFolder(db: D1Database, owner: string, input: CreateFolderInput): Promise<Folder> {
  const name = validateName(input.name)
  const links = await loadFolderLinks(db, owner)

  if (input.parentId !== null) {
    requireOwnedParent(links, input.parentId)
    if (!canCreateUnder(links, input.parentId)) {
      throw new ApiException(409, 'folder_too_deep', 'folder nesting would exceed the depth limit')
    }
  }

  const id = generateId()
  const now = Date.now()
  const sortOrder = await nextSortOrder(db, owner, input.parentId)

  await db
    .prepare(
      `INSERT INTO folders (id, owner, parent_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, owner, input.parentId, name, sortOrder, now, now)
    .run()

  return { id, parentId: input.parentId, name, sortOrder, createdAt: now, updatedAt: now }
}

export async function updateFolder(
  db: D1Database,
  owner: string,
  id: string,
  input: UpdateFolderInput,
): Promise<Folder | null> {
  const links = await loadFolderLinks(db, owner)
  if (!links.some((f) => f.id === id)) return null

  const name = input.name !== undefined ? validateName(input.name) : undefined

  let sortOrder: number | undefined
  if (input.parentId !== undefined) {
    if (input.parentId !== null) requireOwnedParent(links, input.parentId)
    const check = checkMove(links, id, input.parentId)
    if (check === 'not_found') throw new ApiException(400, 'folder_not_found', 'parent folder not found')
    if (check === 'cycle') {
      throw new ApiException(409, 'folder_cycle', 'a folder cannot move into itself or one of its descendants')
    }
    if (check === 'too_deep') {
      throw new ApiException(409, 'folder_too_deep', 'folder nesting would exceed the depth limit')
    }
    sortOrder = await nextSortOrder(db, owner, input.parentId)
  }

  const setClauses: string[] = []
  const bindings: unknown[] = []
  if (name !== undefined) {
    setClauses.push('name = ?')
    bindings.push(name)
  }
  if (input.parentId !== undefined) {
    setClauses.push('parent_id = ?', 'sort_order = ?')
    bindings.push(input.parentId, sortOrder)
  }

  if (setClauses.length > 0) {
    setClauses.push('updated_at = ?')
    bindings.push(Date.now())
    await db
      .prepare(`UPDATE folders SET ${setClauses.join(', ')} WHERE id = ? AND owner = ?`)
      .bind(...bindings, id, owner)
      .run()
  }

  return getFolder(db, owner, id)
}

export type DeleteFolderResult = 'deleted' | 'not_found'

export async function deleteFolder(db: D1Database, owner: string, id: string): Promise<DeleteFolderResult> {
  // Only checked for existence (404); its parent_id is never read here, so a
  // move landing between this check and the batch below cannot make the
  // reparenting below use a stale parent. Each statement in the batch looks
  // up the live parent_id itself, inside the same transaction.
  const exists = await db.prepare('SELECT 1 FROM folders WHERE id = ? AND owner = ?').bind(id, owner).first()
  if (!exists) return 'not_found'

  const parentIdSubquery = 'SELECT parent_id FROM folders WHERE id = ? AND owner = ?'

  // Reparenting happens before the delete, in the same batch, so a foreign
  // key violation rolls the whole thing back instead of losing child folders
  // or notes that were left pointing at a row that no longer exists. The
  // DELETE runs last so the subquery above still sees the row.
  await db.batch([
    db
      .prepare(`UPDATE folders SET parent_id = (${parentIdSubquery}) WHERE parent_id = ? AND owner = ?`)
      .bind(id, owner, id, owner),
    db
      .prepare(`UPDATE notes SET folder_id = (${parentIdSubquery}) WHERE folder_id = ? AND owner = ?`)
      .bind(id, owner, id, owner),
    db.prepare('DELETE FROM folders WHERE id = ? AND owner = ?').bind(id, owner),
  ])

  return 'deleted'
}
