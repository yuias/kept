import { FOLDER_DEPTH_MAX } from './limits'
import type { Folder, FolderSort } from './types'

export interface FolderLink {
  id: string
  parentId: string | null
}

function byId(folders: readonly FolderLink[]): Map<string, FolderLink> {
  const map = new Map<string, FolderLink>()
  for (const f of folders) map.set(f.id, f)
  return map
}

// Root-level folders have depth 1.
export function depthOf(folders: FolderLink[], id: string): number {
  const map = byId(folders)
  let depth = 0
  let current: string | null = id
  const seen = new Set<string>()
  while (current !== null) {
    if (seen.has(current)) break // guard against cycles in malformed data
    seen.add(current)
    const folder = map.get(current)
    if (!folder) break
    depth += 1
    current = folder.parentId
  }
  return depth
}

// A leaf folder has height 1.
export function subtreeHeight(folders: FolderLink[], id: string): number {
  const childrenByParent = new Map<string | null, FolderLink[]>()
  for (const f of folders) {
    const list = childrenByParent.get(f.parentId) ?? []
    list.push(f)
    childrenByParent.set(f.parentId, list)
  }

  function heightOf(nodeId: string): number {
    const children = childrenByParent.get(nodeId) ?? []
    if (children.length === 0) return 1
    return 1 + Math.max(...children.map((c) => heightOf(c.id)))
  }

  return heightOf(id)
}

export function isDescendantOrSelf(folders: FolderLink[], ancestorId: string, id: string): boolean {
  const map = byId(folders)
  let current: string | null = id
  const seen = new Set<string>()
  while (current !== null) {
    if (current === ancestorId) return true
    if (seen.has(current)) break
    seen.add(current)
    const folder = map.get(current)
    if (!folder) break
    current = folder.parentId
  }
  return false
}

export function canCreateUnder(folders: FolderLink[], parentId: string | null): boolean {
  if (parentId === null) return true
  const depth = depthOf(folders, parentId)
  if (depth === 0) return false // parent not found
  return depth + 1 <= FOLDER_DEPTH_MAX
}

export type MoveCheck = 'ok' | 'not_found' | 'cycle' | 'too_deep'

export function checkMove(folders: FolderLink[], id: string, newParentId: string | null): MoveCheck {
  const map = byId(folders)
  if (!map.has(id)) return 'not_found'
  if (newParentId === null) return 'ok'
  if (!map.has(newParentId)) return 'not_found'
  if (isDescendantOrSelf(folders, id, newParentId)) return 'cycle'
  const newDepth = depthOf(folders, newParentId)
  const height = subtreeHeight(folders, id)
  if (newDepth + height > FOLDER_DEPTH_MAX) return 'too_deep'
  return 'ok'
}

export interface FolderTreeNode<T> {
  folder: T
  children: FolderTreeNode<T>[]
}

function compareFolders<T extends Folder>(sort: FolderSort): (a: T, b: T) => number {
  switch (sort) {
    case 'name':
      return (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    case 'created':
      return (a, b) => b.createdAt - a.createdAt
    case 'updated':
      return (a, b) => b.updatedAt - a.updatedAt
    case 'manual':
      return (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  }
}

export function buildTree<T extends Folder>(folders: T[], sort: FolderSort): FolderTreeNode<T>[] {
  const compare = compareFolders<T>(sort)
  const childrenByParent = new Map<string | null, T[]>()
  for (const f of folders) {
    const list = childrenByParent.get(f.parentId) ?? []
    list.push(f)
    childrenByParent.set(f.parentId, list)
  }

  function buildLevel(parentId: string | null): FolderTreeNode<T>[] {
    const children = (childrenByParent.get(parentId) ?? []).slice().sort(compare)
    return children.map((folder) => ({ folder, children: buildLevel(folder.id) }))
  }

  return buildLevel(null)
}
