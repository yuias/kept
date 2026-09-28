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
 * Opens or closes the note editor by updating the `note` query param with
 * `pushState`, so the browser Back button closes the dialog.
 */
export function openNote(id: string | null, options: { replace?: boolean } = {}): void {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('note', id)
  else url.searchParams.delete('note')

  // `replace` swaps the id in place after creating a note; unlike `navigate`,
  // this must not scroll the grid behind the dialog back to the top.
  if (options.replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
  state.current = parseRoute(url.pathname, url.search)
}
