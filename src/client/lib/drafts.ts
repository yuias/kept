/**
 * Local copies of note edits that have not reached the server yet, so a
 * reload (signing in again after the session expired, a crash, closing the
 * tab mid-save) does not lose them. Plain TS so vitest can exercise it with
 * a fake `Storage`.
 */

export interface Draft {
  title: string
  body: string
  /** The raw input, so a half-typed label list comes back as it was. */
  labelsText: string
  /** The note's `updatedAt` the edits were made on; null for a note not created yet. */
  baseUpdatedAt: number | null
}

const PREFIX = 'kept.draft.'

/** A note that has no id yet shares one slot; there is only ever one "new" editor open. */
export const NEW_NOTE_DRAFT = 'new'

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // Accessing localStorage itself throws when site data is blocked.
    return null
  }
}

function isDraft(value: unknown): value is Draft {
  if (typeof value !== 'object' || value === null) return false
  const draft = value as Record<string, unknown>
  return (
    typeof draft.title === 'string' &&
    typeof draft.body === 'string' &&
    typeof draft.labelsText === 'string' &&
    (draft.baseUpdatedAt === null || typeof draft.baseUpdatedAt === 'number')
  )
}

export function readDraft(key: string, storage: Storage | null = defaultStorage()): Draft | null {
  try {
    const raw = storage?.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return isDraft(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Best effort: a full or blocked storage only costs the safety net, never the edit. */
export function writeDraft(key: string, draft: Draft, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(PREFIX + key, JSON.stringify(draft))
  } catch {
    // Quota exceeded or storage disabled.
  }
}

export function clearDraft(key: string, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.removeItem(PREFIX + key)
  } catch {
    // Storage disabled; there is nothing to clear.
  }
}
