import type { LinkPreview } from '../../shared/types'
import { fetchLinkPreview } from './api'

const resolved = new Map<string, LinkPreview>()
const inFlight = new Map<string, Promise<LinkPreview>>()

/** The resolved preview if already loaded, so a redrawn widget can render it synchronously. */
export function peekLinkPreview(url: string): LinkPreview | undefined {
  return resolved.get(url)
}

/**
 * One request per URL. A rejection (network, 400, 401) is not memoized so a
 * later redraw retries; a `failed` preview is, since the server caches it too.
 */
export function loadLinkPreview(
  url: string,
  fetcher: (url: string) => Promise<LinkPreview> = fetchLinkPreview,
): Promise<LinkPreview> {
  const known = resolved.get(url)
  if (known) return Promise.resolve(known)
  const pending = inFlight.get(url)
  if (pending) return pending

  const request = fetcher(url).then(
    (preview) => {
      resolved.set(url, preview)
      inFlight.delete(url)
      return preview
    },
    (error: unknown) => {
      inFlight.delete(url)
      throw error
    },
  )
  inFlight.set(url, request)
  return request
}

/** `/api/fetch-image?url=...` for an absolute image URL. */
export function proxiedImageSrc(url: string): string {
  return `/api/fetch-image?url=${encodeURIComponent(url)}`
}
