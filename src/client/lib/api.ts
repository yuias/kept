import type {
  AppSettings,
  CreateFolderInput,
  CreateNoteInput,
  Folder,
  ImageUploadResponse,
  LabelCount,
  LinkPreview,
  MeResponse,
  Note,
  NoteListResponse,
  ReorderFoldersInput,
  UpdateFolderInput,
  UpdateNoteInput,
} from '../../shared/types'
import type { ListQuery } from './routes'

/** Thrown by `request` for every non-2xx response, plus a few client-side conditions. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { accept: 'application/json', ...init?.headers },
    })
  } catch {
    // A cross-origin redirect to the Access login page surfaces here.
    throw new ApiError(0, 'network', 'the server could not be reached')
  }

  if (response.status === 204) return undefined as T

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
  if (!isJson) {
    // Access answers an expired session with a redirect to its login page.
    throw new ApiError(
      response.status,
      response.redirected ? 'session_expired' : 'unexpected_response',
      `expected JSON, got ${response.status}`,
    )
  }

  const body = (await response.json()) as unknown

  if (!response.ok) {
    const error = body as { error?: string; message?: string }
    throw new ApiError(response.status, error.error ?? 'error', error.message ?? 'the request failed')
  }

  return body as T
}

function withJsonBody(method: string, input: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }
}

export function fetchMe(): Promise<MeResponse> {
  return request<MeResponse>('/api/me')
}

export interface ListNotesParams extends ListQuery {
  cursor?: string | null
  limit?: number
}

export function listNotes(params: ListNotesParams): Promise<NoteListResponse> {
  const search = new URLSearchParams()
  search.set('view', params.view)
  if (params.folder) search.set('folder', params.folder)
  if (params.label) search.set('label', params.label)
  if (params.q) search.set('q', params.q)
  if (params.cursor) search.set('cursor', params.cursor)
  if (params.limit) search.set('limit', String(params.limit))

  return request<NoteListResponse>(`/api/notes?${search}`)
}

export function createNote(input: CreateNoteInput): Promise<Note> {
  return request<Note>('/api/notes', withJsonBody('POST', input))
}

export function fetchNote(id: string): Promise<Note> {
  return request<Note>(`/api/notes/${id}`)
}

export function updateNote(id: string, input: UpdateNoteInput): Promise<Note> {
  return request<Note>(`/api/notes/${id}`, withJsonBody('PATCH', input))
}

export function trashNote(id: string): Promise<Note> {
  return request<Note>(`/api/notes/${id}/trash`, { method: 'POST' })
}

export function restoreNote(id: string): Promise<Note> {
  return request<Note>(`/api/notes/${id}/restore`, { method: 'POST' })
}

export function deleteNoteForever(id: string): Promise<void> {
  return request<void>(`/api/notes/${id}`, { method: 'DELETE' })
}

export function emptyTrash(): Promise<void> {
  return request<void>('/api/trash', { method: 'DELETE' })
}

export function listFolders(): Promise<Folder[]> {
  return request<Folder[]>('/api/folders')
}

export function createFolder(input: CreateFolderInput): Promise<Folder> {
  return request<Folder>('/api/folders', withJsonBody('POST', input))
}

export function updateFolder(id: string, input: UpdateFolderInput): Promise<Folder> {
  return request<Folder>(`/api/folders/${id}`, withJsonBody('PATCH', input))
}

export function reorderFolders(input: ReorderFoldersInput): Promise<void> {
  return request<void>('/api/folders/reorder', withJsonBody('POST', input))
}

export function deleteFolder(id: string): Promise<void> {
  return request<void>(`/api/folders/${id}`, { method: 'DELETE' })
}

export function listLabels(): Promise<LabelCount[]> {
  return request<LabelCount[]>('/api/labels')
}

export function fetchSettings(): Promise<AppSettings> {
  return request<AppSettings>('/api/settings')
}

export function updateSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  return request<AppSettings>('/api/settings', withJsonBody('PUT', input))
}

export function fetchLinkPreview(url: string): Promise<LinkPreview> {
  return request<LinkPreview>(`/api/link-preview?url=${encodeURIComponent(url)}`)
}

export function uploadImage(
  webp: ArrayBuffer,
  width: number,
  height: number,
  sourceUrl?: string,
): Promise<ImageUploadResponse> {
  const headers: Record<string, string> = {
    'content-type': 'image/webp',
    'x-image-width': String(width),
    'x-image-height': String(height),
  }
  if (sourceUrl) headers['x-source-url'] = sourceUrl

  return request<ImageUploadResponse>('/api/images', { method: 'POST', headers, body: webp })
}

/**
 * Fetches an image through the server-side proxy. Unlike `request`, the
 * response body is the image itself, not JSON, so this does not go through it.
 */
export async function fetchImageProxy(url: string): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(`/api/fetch-image?url=${encodeURIComponent(url)}`)
  } catch {
    throw new ApiError(0, 'network', 'the server could not be reached')
  }

  if (!response.ok) {
    let error: { error?: string; message?: string } = {}
    try {
      error = (await response.json()) as typeof error
    } catch {
      // An Access login redirect or another non-JSON response.
    }
    throw new ApiError(response.status, error.error ?? 'error', error.message ?? 'the request failed')
  }

  return response.blob()
}
