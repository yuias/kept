import { TRASH_RETENTION_DEFAULT_DAYS } from './retention'

export type NoteFormat = 'inherit' | 'formatted' | 'syntax'
export type ConcreteFormat = Exclude<NoteFormat, 'inherit'>
export type NoteView = 'notes' | 'archive' | 'trash' | 'all'
export type FolderSort = 'name' | 'created' | 'updated' | 'manual'

export interface MeResponse {
  email: string
  name: string
  authenticated: boolean
  stale: boolean
  dev: boolean
}

export interface ApiErrorBody {
  error: string
  message: string
}

export interface NoteSummary {
  id: string
  title: string
  preview: string
  /** Up to CARD_IMAGES_MAX local image URLs from the body, for the card preview. */
  images: string[]
  format: NoteFormat
  folderId: string | null
  labels: string[]
  pinned: boolean
  archived: boolean
  /** Read-only in the editor (task checkboxes excepted); not enforced by the API. */
  locked: boolean
  trashedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface Note extends Omit<NoteSummary, 'preview' | 'images'> {
  body: string
  summary: string | null
}

export interface NoteListResponse {
  items: NoteSummary[]
  nextCursor: string | null
  scanLimited?: boolean
}

export interface CreateNoteInput {
  title?: string
  body?: string
  folderId?: string | null
  labels?: string[]
}

export interface UpdateNoteInput {
  title?: string
  body?: string
  format?: NoteFormat
  folderId?: string | null
  labels?: string[]
  pinned?: boolean
  archived?: boolean
  locked?: boolean
}

export interface Folder {
  id: string
  parentId: string | null
  name: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface CreateFolderInput {
  name: string
  parentId: string | null
}

export interface UpdateFolderInput {
  name?: string
  parentId?: string | null
}

export interface ReorderFoldersInput {
  parentId: string | null
  ids: string[]
}

export interface LabelCount {
  name: string
  count: number
}

export interface AppSettings {
  defaultFormat: ConcreteFormat
  folderSort: FolderSort
  /** Days a note stays in the trash before the daily purge deletes it; null = never. */
  trashRetentionDays: number | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultFormat: 'formatted',
  folderSort: 'name',
  trashRetentionDays: TRASH_RETENTION_DEFAULT_DAYS,
}

export interface ImageUploadResponse {
  id: string
  url: string
  width: number
  height: number
  bytes: number
}

export interface LinkPreview {
  /** 'failed' when the page could not be fetched or was not HTML; the client then shows the domain only. */
  status: 'ok' | 'failed'
  /** The requested URL, as normalized by `new URL()`. */
  url: string
  /** The URL after redirects; equals `url` when failed before any response. */
  finalUrl: string
  title: string | null
  description: string | null
  siteName: string | null
  /** Absolute http(s) URLs, to be loaded through /api/fetch-image. */
  image: string | null
  favicon: string | null
}
