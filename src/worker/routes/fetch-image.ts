import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { FETCH_MAX_BYTES, FETCH_TIMEOUT_MS } from '../../shared/limits'
import { requireIdentity } from '../auth'
import { readCappedBody } from '../body'
import { validateFetchUrl } from '../fetch-guard'
import { fetchWithSafeRedirects, drain } from '../guarded-fetch'
import { ApiException, type HonoEnv } from '../http'

export const fetchImageRoutes = new Hono<HonoEnv>()

/** SVG is refused: it cannot be rasterised in a Worker, and it can carry scripts. */
const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
])

fetchImageRoutes.get('/api/fetch-image', requireIdentity, async (c) => {
  const raw = c.req.query('url')
  if (!raw) throw new ApiException(400, 'invalid_url', 'the url query parameter is required')

  const start = validateFetchUrl(raw)
  if (!start.ok) throw new ApiException(400, start.code, `the url is not allowed (${start.code})`)

  // One deadline covers every hop plus the final download, since a chain of
  // redirects that each individually respect a per-hop timeout could still
  // stall the request indefinitely.
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)

  const { response } = await fetchWithSafeRedirects(start.url, { signal })

  if (!response.ok) {
    await drain(response)
    throw new HTTPException(502, { message: 'the upstream server returned an error' })
  }

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    await drain(response)
    throw new HTTPException(415, { message: `unsupported upstream content-type: ${contentType || '(none)'}` })
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > FETCH_MAX_BYTES) {
    await drain(response)
    throw new HTTPException(413, { message: 'the image exceeds the size limit' })
  }

  // The content-length header may be absent or wrong, same as the upload
  // route: streaming the body and capping the running total is what can be
  // trusted, and it avoids buffering an oversized body in full.
  let bytes: Uint8Array
  try {
    bytes = await readCappedBody(response.body, FETCH_MAX_BYTES, 'the image exceeds the size limit')
  } catch (error) {
    // A cap violation raises its own HTTPException(413); anything else (the
    // timeout firing mid-body, a connection reset) is still an upstream
    // failure, same as one that fails before headers arrive.
    if (error instanceof HTTPException) throw error
    throw new HTTPException(502, { message: 'the upstream connection failed while reading the body' })
  }

  return c.body(bytes.buffer as ArrayBuffer, 200, {
    'content-type': contentType,
    'cache-control': 'private, max-age=86400',
    'x-content-type-options': 'nosniff',
  })
})
