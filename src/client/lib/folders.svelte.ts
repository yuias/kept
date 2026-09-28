import { buildTree, canCreateUnder, checkMove, type FolderTreeNode } from '../../shared/folder-tree'
import type { Folder } from '../../shared/types'
import {
  createFolder as createFolderRequest,
  deleteFolder as deleteFolderRequest,
  listFolders as listFoldersRequest,
  updateFolder as updateFolderRequest,
} from './api'
import { describeApiError } from './errors'
import { messages } from './i18n.svelte'
import { settings } from './settings.svelte'

const EXPANDED_KEY = 'kept.folders.expanded'

function readExpanded(): string[] {
  try {
    const stored = localStorage.getItem(EXPANDED_KEY)
    const parsed = stored ? (JSON.parse(stored) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    // Private browsing modes can throw on access, and malformed JSON is
    // possible too; either way, start with nothing expanded.
    return []
  }
}

function persistExpanded(ids: string[]): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(ids))
  } catch {
    // Persisting is best-effort; expansion still applies to this session.
  }
}

const state = $state<{ folders: Folder[]; loaded: boolean; expanded: string[]; error: string | null }>({
  folders: [],
  loaded: false,
  expanded: readExpanded(),
  error: null,
})

async function load(): Promise<void> {
  try {
    state.folders = await listFoldersRequest()
  } catch {
    // The sidebar just shows no folders; list routes surface their own errors.
  } finally {
    state.loaded = true
  }
}

/** Settles once the initial load has finished, successfully or not. */
export const foldersReady: Promise<void> = load()

export function folders(): Folder[] {
  return state.folders
}

export function folderById(id: string): Folder | undefined {
  return state.folders.find((f) => f.id === id)
}

/** Re-derived on every call, so a `settings().folderSort` change re-sorts for free. */
export function folderTree(): FolderTreeNode<Folder>[] {
  return buildTree(state.folders, settings().folderSort)
}

export function folderError(): string | null {
  return state.error
}

export function isFolderExpanded(id: string): boolean {
  return state.expanded.includes(id)
}

export function setFolderExpanded(id: string, expanded: boolean): void {
  if (expanded === state.expanded.includes(id)) return
  state.expanded = expanded ? [...state.expanded, id] : state.expanded.filter((existing) => existing !== id)
  persistExpanded(state.expanded)
}

export function toggleFolderExpanded(id: string): void {
  setFolderExpanded(id, !isFolderExpanded(id))
}

export function canCreateSubfolder(parentId: string | null): boolean {
  return canCreateUnder(state.folders, parentId)
}

/** Reloads from the server; used after creating a folder so sort fields it assigns come back correctly. */
export async function reloadFolders(): Promise<void> {
  state.error = null
  try {
    state.folders = await listFoldersRequest()
  } catch (cause) {
    state.error = describeApiError(cause, messages())
  }
}

export async function createFolder(name: string, parentId: string | null): Promise<Folder | null> {
  state.error = null
  try {
    const folder = await createFolderRequest({ name, parentId })
    await reloadFolders()
    if (parentId) setFolderExpanded(parentId, true)
    return folder
  } catch (cause) {
    state.error = describeApiError(cause, messages())
    return null
  }
}

export async function renameFolder(id: string, name: string): Promise<Folder | null> {
  state.error = null
  try {
    const folder = await updateFolderRequest(id, { name })
    await reloadFolders()
    return folder
  } catch (cause) {
    state.error = describeApiError(cause, messages())
    return null
  }
}

export async function moveFolder(id: string, parentId: string | null): Promise<Folder | null> {
  state.error = null
  try {
    const folder = await updateFolderRequest(id, { parentId })
    await reloadFolders()
    if (parentId) setFolderExpanded(parentId, true)
    return folder
  } catch (cause) {
    state.error = describeApiError(cause, messages())
    return null
  }
}

export async function removeFolder(id: string): Promise<boolean> {
  state.error = null
  try {
    await deleteFolderRequest(id)
    await reloadFolders()
    return true
  } catch (cause) {
    state.error = describeApiError(cause, messages())
    return false
  }
}

/** Targets `checkMove` would reject for this folder: itself, its subtree, and anything too deep. */
export function disabledMoveTargets(id: string): string[] {
  return state.folders.filter((f) => checkMove(state.folders, id, f.id) !== 'ok').map((f) => f.id)
}
