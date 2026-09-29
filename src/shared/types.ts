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
}

export const DEFAULT_SETTINGS: AppSettings = { defaultFormat: 'formatted', folderSort: 'name' }

export interface ImageUploadResponse {
  id: string
  url: string
  width: number
  height: number
  bytes: number
}
