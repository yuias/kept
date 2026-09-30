import { isNoteOverlayState, NOTE_OVERLAY_STATE } from './note-history'
import { parseRoute, type Route } from './routes'

const state = $state<{ current: Route }>({
  current: parseRoute(window.location.pathname, window.location.search),
})

window.addEventListener('popstate', () => {
  state.current = parseRoute(window.location.pathname, window.location.search)
})

export function currentRoute(): Route {
  return state.current
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const url = new URL(to, window.location.origin)
  if (url.href === window.location.href) return

  if (options.replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)

  state.current = parseRoute(url.pathname, url.search)
  window.scrollTo(0, 0)
}

/** Intercepts same-origin clicks so `<a href>` works without a full reload. */
export function link(node: HTMLAnchorElement): { destroy(): void } {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const href = node.getAttribute('href')
    if (!href || href.startsWith('http') || node.target) return

    event.preventDefault()
    navigate(href)
  }

  node.addEventListener('click', onClick)
  return { destroy: () => node.removeEventListener('click', onClick) }
}

/**
 * Opens the note editor by setting the `note` query param. A plain open pushes
 * an entry tagged with `NOTE_OVERLAY_STATE`, so `closeNote` can step back to
 * the list page and the browser Back button closes the dialog.
 */
export function openNote(id: string, options: { replace?: boolean } = {}): void {
  const url = new URL(window.location.href)
  url.searchParams.set('note', id)

  // `replace` swaps the id in place after creating a note; unlike `navigate`,
  // this must not scroll the grid behind the dialog back to the top. It keeps
  // the current state so an existing overlay marker survives.
  if (options.replace) window.history.replaceState(window.history.state, '', url)
  else window.history.pushState(NOTE_OVERLAY_STATE, '', url)
  state.current = parseRoute(url.pathname, url.search)
}

/**
 * Closes the note editor. When `openNote` pushed the current entry, go back so
 * the grid keeps its scroll position and Back does not reopen the note.
 */
export function closeNote(): void {
  if (isNoteOverlayState(window.history.state)) {
    // `popstate` updates the route. After a reload on this entry the list
    // entry belongs to the old document, so this is a full page load instead.
    window.history.back()
    return
  }

  // Deep link, reload without the marker, or arrival from another page: a
  // pushed "closed" entry would make the next Back (or Android's Back gesture
  // that already closed the dialog) reopen the note, so rewrite in place.
  const url = new URL(window.location.href)
  url.searchParams.delete('note')
  window.history.replaceState(null, '', url)
  state.current = parseRoute(url.pathname, url.search)
}
