/**
 * Pure route parsing, kept free of Svelte runes and DOM access so vitest can
 * import it directly. `router.svelte.ts` wraps this in reactive state.
 */

// Local copy of the note-view union; shared/types.ts does not define it yet.
export type NoteView = 'notes' | 'archive' | 'trash' | 'all'

export type Route =
  | { name: 'notes' }
  | { name: 'archive' }
  | { name: 'trash' }
  | { name: 'folder'; id: string }
  | { name: 'label'; label: string }
  | { name: 'search'; q: string }
  | { name: 'settings' }
  | { name: 'notfound' }

export interface ListQuery {
  view: NoteView
  folder?: string
  label?: string
  q?: string
}

export function parseRoute(pathname: string, search: string): Route {
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 0) return { name: 'notes' }

  if (segments.length === 1) {
    if (segments[0] === 'archive') return { name: 'archive' }
    if (segments[0] === 'trash') return { name: 'trash' }
    if (segments[0] === 'settings') return { name: 'settings' }
    if (segments[0] === 'search') {
      const params = new URLSearchParams(search)
      return { name: 'search', q: params.get('q') ?? '' }
    }
  }

  if (segments.length === 2 && segments[1] && (segments[0] === 'folder' || segments[0] === 'label')) {
    try {
      const value = decodeURIComponent(segments[1])
      return segments[0] === 'folder' ? { name: 'folder', id: value } : { name: 'label', label: value }
    } catch {
      // A malformed percent-escape is not a valid path; fall through to notfound.
    }
  }

  return { name: 'notfound' }
}

/** Maps a route to the query the note list fetches with, or null for non-list routes. */
export function listQueryFor(route: Route): ListQuery | null {
  switch (route.name) {
    case 'notes':
      return { view: 'notes' }
    case 'archive':
      return { view: 'archive' }
    case 'trash':
      return { view: 'trash' }
    case 'folder':
      return { view: 'notes', folder: route.id }
    case 'label':
      return { view: 'notes', label: route.label }
    case 'search':
      return { view: 'all', q: route.q }
    default:
      return null
  }
}

/** The `note=<id>|new` query param that opens the editor dialog over any list route. */
export function noteParam(search: string): string | null {
  return new URLSearchParams(search).get('note')
}
