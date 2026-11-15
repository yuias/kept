import { updateNote } from './api'
import { describeApiError } from './errors'
import { messages } from './i18n.svelte'
import type { NoteDragPayload } from './note-drag'

const state = $state<{ version: number; error: string | null }>({ version: 0, error: null })

/** Bumped after notes change outside NotesView (a sidebar move, a folder delete), so the grid can reload. */
export function notesVersion(): number {
  return state.version
}

export function bumpNotesVersion(): void {
  state.version += 1
}

export function noteMoveError(): string | null {
  return state.error
}

/** PATCHes folderId unless it is unchanged; on success bumps notesVersion, on failure sets noteMoveError. Never throws. */
export async function moveNoteToFolder(payload: NoteDragPayload, folderId: string | null): Promise<void> {
  state.error = null
  if (payload.folderId === folderId) return
  try {
    await updateNote(payload.id, { folderId })
    bumpNotesVersion()
  } catch (cause) {
    state.error = describeApiError(cause, messages())
  }
}
