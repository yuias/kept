/** history.state marker on an entry that openNote pushed over a list page. */
export const NOTE_OVERLAY_STATE: { readonly keptNoteOverlay: true } = { keptNoteOverlay: true }

export function isNoteOverlayState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { keptNoteOverlay?: unknown }).keptNoteOverlay === true
}
