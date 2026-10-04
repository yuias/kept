import { HTTPException } from 'hono/http-exception'
import { FETCH_MAX_REDIRECTS } from '../shared/limits'
import { validateFetchUrl } from './fetch-guard'
import { ApiException } from './http'

export interface GuardedFetchInit {
  /** One deadline for every hop plus the caller's body read. */
  signal: AbortSignal
  /** Sent to upstream on every hop. Omitted entirely from fetch() when undefined. */
  headers?: Record<string, string>
}

export interface GuardedFetchResult {
  /** The first non-3xx response; its body is unread. */
  response: Response
  /** The URL that produced `response`, after redirects. */
  finalUrl: URL
}

/**
 * Discards a response body that will never be read (a redirect hop, or one
 * rejected before its bytes are consumed). Cloudflare Workers otherwise keep
 * the underlying connection open until the body is drained or cancelled.
 */
export async function drain(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {})
}

/**
 * Fetches `start` (already validated by the caller with validateFetchUrl),
 * following at most FETCH_MAX_REDIRECTS redirects manually and validating
 * each hop. Throws HTTPException(502) for network failure, too many redirects
 * or a missing/malformed Location, and ApiException(400, code) for a blocked
 * redirect target.
 */
export async function fetchWithSafeRedirects(start: URL, init: GuardedFetchInit): Promise<GuardedFetchResult> {
  let target = start
  let redirectsFollowed = 0

  for (;;) {
    let response: Response
    try {
      // `redirect: 'manual'` is what makes each hop's target visible to the
      // SSRF check below, instead of `fetch` silently following it. `headers`
      // is spread in only when given, so callers without it send no headers key.
      response = await fetch(target.toString(), {
        redirect: 'manual',
        signal: init.signal,
        ...(init.headers ? { headers: init.headers } : {}),
      })
    } catch {
      throw new HTTPException(502, { message: 'the upstream fetch failed' })
    }

    if (response.status < 300 || response.status >= 400) return { response, finalUrl: target }

    if (redirectsFollowed >= FETCH_MAX_REDIRECTS) {
      await drain(response)
      throw new HTTPException(502, { message: 'too many redirects' })
    }
    redirectsFollowed++

    const location = response.headers.get('location')
    if (!location) {
      await drain(response)
      throw new HTTPException(502, { message: 'redirect with no location header' })
    }

    let redirected: URL
    try {
      redirected = new URL(location, target)
    } catch {
      await drain(response)
      throw new HTTPException(502, { message: 'the redirect target is malformed' })
    }

    const next = validateFetchUrl(redirected.toString())
    if (!next.ok) {
      await drain(response)
      throw new ApiException(400, next.code, `the redirect target is not allowed (${next.code})`)
    }

    // The redirect response itself carries no useful body; only its target matters.
    await drain(response)
    target = next.url
  }
}
