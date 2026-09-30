/**
 * history.state marker on an entry that openNote pushed over a list page.
 * `doc` identifies the page load that pushed it: after a reload the entry
 * before it belongs to a discarded document, and going back to it would
 * unload the page instead of firing `popstate`.
 */
export interface NoteOverlayState {
  readonly keptNoteOverlay: true
  readonly doc: string
}

export function noteOverlayState(doc: string): NoteOverlayState {
  return { keptNoteOverlay: true, doc }
}

/** True when `state` is a marker pushed by the page load identified by `doc`. */
export function isOwnNoteOverlay(state: unknown, doc: string): boolean {
  if (typeof state !== 'object' || state === null) return false
  const marker = state as { keptNoteOverlay?: unknown; doc?: unknown }
  return marker.keptNoteOverlay === true && marker.doc === doc
}
