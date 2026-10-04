import { Hono } from 'hono'
import {
  LINK_PREVIEW_FAILURE_TTL_MS,
  LINK_PREVIEW_MAX_BYTES,
  LINK_PREVIEW_TIMEOUT_MS,
  LINK_PREVIEW_TTL_MS,
  LINK_PREVIEW_URL_MAX_CHARS,
} from '../../shared/limits'
import type { LinkPreview } from '../../shared/types'
import { requireIdentity } from '../auth'
import { validateFetchUrl } from '../fetch-guard'
import { drain, fetchWithSafeRedirects } from '../guarded-fetch'
import { ApiException, ownerOf, type HonoEnv } from '../http'
import { buildPreview } from '../link-preview-head'
import { readHead } from '../link-preview-read'
import { getCachedPreview, putCachedPreview } from '../link-preview-repo'

export const linkPreviewRoutes = new Hono<HonoEnv>()

// Many sites return a block page or nothing to requests without a User-Agent.
const UPSTREAM_HEADERS = {
  accept: 'text/html',
  'user-agent': 'Mozilla/5.0 (compatible; kept-link-preview/1.0)',
}

function failedPreview(url: string, finalUrl: string): LinkPreview {
  return { status: 'failed', url, finalUrl, title: null, description: null, siteName: null, image: null, favicon: null }
}

/** Fetches and parses the page; any failure becomes a 'failed' preview rather than an error. */
async function fetchPreview(key: string, start: URL): Promise<{ preview: LinkPreview; ttlMs: number }> {
  const failed = (finalUrl: string) => ({ preview: failedPreview(key, finalUrl), ttlMs: LINK_PREVIEW_FAILURE_TTL_MS })

  let response: Response
  let finalUrl: URL
  try {
    // One deadline covers every hop plus the head read.
    ;({ response, finalUrl } = await fetchWithSafeRedirects(start, {
      signal: AbortSignal.timeout(LINK_PREVIEW_TIMEOUT_MS),
      headers: UPSTREAM_HEADERS,
    }))
  } catch {
    return failed(key)
  }

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!response.ok || contentType !== 'text/html') {
    await drain(response)
    return failed(finalUrl.toString())
  }

  try {
    const head = await readHead(response, LINK_PREVIEW_MAX_BYTES)
    return { preview: buildPreview(head, key, finalUrl), ttlMs: LINK_PREVIEW_TTL_MS }
  } catch {
    return failed(finalUrl.toString())
  }
}

linkPreviewRoutes.get('/api/link-preview', requireIdentity, async (c) => {
  const raw = c.req.query('url')
  if (!raw || raw.length > LINK_PREVIEW_URL_MAX_CHARS) {
    throw new ApiException(400, 'invalid_url', 'a url query parameter of reasonable length is required')
  }

  const start = validateFetchUrl(raw)
  if (!start.ok) throw new ApiException(400, start.code, `the url is not allowed (${start.code})`)

  // Fragments never reach the server, so they must not split the cache.
  start.url.hash = ''
  const key = start.url.toString()
  const owner = ownerOf(c)
  const now = Date.now()

  const cached = await getCachedPreview(c.env.DB, owner, key, now)
  if (cached !== null) return c.json(cached, 200, { 'cache-control': 'private, max-age=3600' })

  const { preview, ttlMs } = await fetchPreview(key, start.url)
  await putCachedPreview(c.env.DB, owner, key, preview, now, ttlMs)

  return c.json(preview, 200, { 'cache-control': 'private, max-age=3600' })
})
