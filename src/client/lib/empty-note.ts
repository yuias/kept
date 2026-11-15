export interface CloseState {
  initialId: string
  noteId: string | null
  /** Trashed on the server, or trashed by this editor's own Trash button. */
  trashed: boolean
  /** Result of the final autosave flush; false means the server may still hold older content. */
  flushed: boolean
  title: string
  body: string
}

/**
 * True when this editor created the note and it is empty when the editor
 * closes. Labels do not count as content, matching what lets a new note be
 * created in the first place.
 */
export function shouldDiscardOnClose(state: CloseState): boolean {
  return (
    state.initialId === 'new' &&
    state.noteId !== null &&
    !state.trashed &&
    state.flushed &&
    state.title.trim() === '' &&
    state.body.trim() === ''
  )
}
