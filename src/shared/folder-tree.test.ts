import { describe, expect, it } from 'vitest'
import {
  buildTree,
  canCreateUnder,
  checkMove,
  depthOf,
  isDescendantOrSelf,
  moveSibling,
  reorderSiblings,
  subtreeHeight,
} from './folder-tree'
import type { Folder } from './types'
import type { FolderLink } from './folder-tree'

function chain(length: number): FolderLink[] {
  const links: FolderLink[] = []
  for (let i = 0; i < length; i++) {
    links.push({ id: `f${i}`, parentId: i === 0 ? null : `f${i - 1}` })
  }
  return links
}

describe('depthOf', () => {
  it('is 1 for a root-level folder', () => {
    const folders: FolderLink[] = [{ id: 'a', parentId: null }]
    expect(depthOf(folders, 'a')).toBe(1)
  })

  it('increases by one per level for nested folders', () => {
    const folders = chain(5)
    expect(depthOf(folders, 'f0')).toBe(1)
    expect(depthOf(folders, 'f4')).toBe(5)
  })

  it('is 0 for an unknown id', () => {
    expect(depthOf([], 'missing')).toBe(0)
  })
})

describe('subtreeHeight', () => {
  it('is 1 for a leaf', () => {
    const folders: FolderLink[] = [{ id: 'a', parentId: null }]
    expect(subtreeHeight(folders, 'a')).toBe(1)
  })

  it('is the longest path down through children', () => {
    const folders: FolderLink[] = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'a' },
    ]
    expect(subtreeHeight(folders, 'a')).toBe(3)
    expect(subtreeHeight(folders, 'b')).toBe(2)
    expect(subtreeHeight(folders, 'd')).toBe(1)
  })
})

describe('isDescendantOrSelf', () => {
  const folders: FolderLink[] = [
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b' },
    { id: 'd', parentId: null },
  ]

  it('is true for the folder itself', () => {
    expect(isDescendantOrSelf(folders, 'a', 'a')).toBe(true)
  })

  it('is true for a descendant', () => {
    expect(isDescendantOrSelf(folders, 'a', 'c')).toBe(true)
  })

  it('is false for an unrelated folder', () => {
    expect(isDescendantOrSelf(folders, 'a', 'd')).toBe(false)
  })
})

describe('canCreateUnder', () => {
  it('is always true at the root', () => {
    expect(canCreateUnder([], null)).toBe(true)
  })

  it('is true when the parent is at depth 7 (child would be depth 8)', () => {
    const folders = chain(7)
    expect(canCreateUnder(folders, 'f6')).toBe(true)
  })

  it('is false when the parent is at depth 8 (child would be depth 9)', () => {
    const folders = chain(8)
    expect(canCreateUnder(folders, 'f7')).toBe(false)
  })
})

describe('checkMove', () => {
  it('is not_found when the moved folder does not exist', () => {
    const folders: FolderLink[] = [{ id: 'a', parentId: null }]
    expect(checkMove(folders, 'missing', null)).toBe('not_found')
  })

  it('is not_found when the target parent does not exist', () => {
    const folders: FolderLink[] = [{ id: 'a', parentId: null }]
    expect(checkMove(folders, 'a', 'missing')).toBe('not_found')
  })

  it('is cycle when moving onto itself', () => {
    const folders: FolderLink[] = [{ id: 'a', parentId: null }]
    expect(checkMove(folders, 'a', 'a')).toBe('cycle')
  })

  it('is cycle when moving onto a descendant', () => {
    const folders: FolderLink[] = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ]
    expect(checkMove(folders, 'a', 'c')).toBe('cycle')
  })

  it('is ok when moving to root', () => {
    const folders: FolderLink[] = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ]
    expect(checkMove(folders, 'b', null)).toBe('ok')
  })

  it('is too_deep when depth(newParent) + subtreeHeight(id) > 8', () => {
    // 'sub' has a child, so subtreeHeight(sub) = 2. Moving it under a
    // depth-7 folder would put its deepest descendant at depth 9.
    const target = chain(7) // f0..f6, depth 7 at f6
    const moved: FolderLink[] = [
      { id: 'sub', parentId: null },
      { id: 'sub-child', parentId: 'sub' },
    ]
    const folders = [...target, ...moved]
    expect(checkMove(folders, 'sub', 'f6')).toBe('too_deep')
  })

  it('is ok when depth(newParent) + subtreeHeight(id) == 8', () => {
    const target = chain(6) // f0..f5, depth 6 at f5
    const moved: FolderLink[] = [
      { id: 'sub', parentId: null },
      { id: 'sub-child', parentId: 'sub' },
    ]
    const folders = [...target, ...moved]
    expect(checkMove(folders, 'sub', 'f5')).toBe('ok')
  })
})

function makeFolder(overrides: Partial<Folder>): Folder {
  return {
    id: 'id',
    parentId: null,
    name: 'name',
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('buildTree', () => {
  const folders: Folder[] = [
    makeFolder({ id: 'b', name: 'Banana', sortOrder: 2, createdAt: 200, updatedAt: 500 }),
    makeFolder({ id: 'a', name: 'apple', sortOrder: 1, createdAt: 300, updatedAt: 100 }),
    makeFolder({ id: 'c', name: 'Cherry', sortOrder: 0, createdAt: 100, updatedAt: 900 }),
    makeFolder({ id: 'a1', parentId: 'a', name: 'nested', sortOrder: 0, createdAt: 400, updatedAt: 400 }),
  ]

  it('nests children under their parent', () => {
    const tree = buildTree(folders, 'name')
    const a = tree.find((n) => n.folder.id === 'a')
    expect(a?.children.map((c) => c.folder.id)).toEqual(['a1'])
  })

  it('sorts by name case-insensitively', () => {
    const tree = buildTree(folders, 'name')
    expect(tree.map((n) => n.folder.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by created newest first', () => {
    const tree = buildTree(folders, 'created')
    expect(tree.map((n) => n.folder.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by updated newest first', () => {
    const tree = buildTree(folders, 'updated')
    expect(tree.map((n) => n.folder.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts by sort_order then name for manual', () => {
    const tree = buildTree(folders, 'manual')
    expect(tree.map((n) => n.folder.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('reorderSiblings', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('moves an item before a later target', () => {
    expect(reorderSiblings(ids, 'a', 'c', false)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('moves an item after a later target', () => {
    expect(reorderSiblings(ids, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item before an earlier target', () => {
    expect(reorderSiblings(ids, 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves an item after the last one', () => {
    expect(reorderSiblings(ids, 'a', 'd', true)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('returns null when the order would not change', () => {
    expect(reorderSiblings(ids, 'a', 'b', false)).toBeNull()
    expect(reorderSiblings(ids, 'b', 'a', true)).toBeNull()
    expect(reorderSiblings(ids, 'c', 'c', true)).toBeNull()
  })

  it('returns null for ids outside the list', () => {
    expect(reorderSiblings(ids, 'x', 'a', false)).toBeNull()
    expect(reorderSiblings(ids, 'a', 'x', false)).toBeNull()
  })

  it('does not mutate the input', () => {
    reorderSiblings(ids, 'a', 'd', true)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('moveSibling', () => {
  const ids = ['a', 'b', 'c']

  it('swaps with the previous sibling', () => {
    expect(moveSibling(ids, 'b', -1)).toEqual(['b', 'a', 'c'])
  })

  it('swaps with the next sibling', () => {
    expect(moveSibling(ids, 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  it('returns null at either end', () => {
    expect(moveSibling(ids, 'a', -1)).toBeNull()
    expect(moveSibling(ids, 'c', 1)).toBeNull()
  })

  it('returns null for a missing id', () => {
    expect(moveSibling(ids, 'x', -1)).toBeNull()
    expect(moveSibling(ids, 'x', 1)).toBeNull()
  })

  it('returns null for a single-element list', () => {
    expect(moveSibling(['a'], 'a', -1)).toBeNull()
    expect(moveSibling(['a'], 'a', 1)).toBeNull()
  })

  it('does not mutate the input', () => {
    moveSibling(ids, 'b', 1)
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})
