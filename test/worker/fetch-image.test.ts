import { afterEach, describe, expect, it, vi } from 'vitest'
import { FETCH_MAX_BYTES, FETCH_TIMEOUT_MS } from '../../src/shared/limits'
import { ANON, call, createTestEnv } from '../support/env'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function fetchImage(env: Parameters<typeof call>[0], url: string, headers: HeadersInit = {}): Promise<Response> {
  return call(env, `/api/fetch-image?url=${encodeURIComponent(url)}`, { headers })
}

/** A ReadableStream that yields well over `FETCH_MAX_BYTES` without allocating it all as one chunk. */
function oversizedStream(): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024 * 1024)
  const chunksNeeded = Math.ceil(FETCH_MAX_BYTES / chunk.byteLength) + 1
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= chunksNeeded) {
        controller.close()
        return
      }
      sent++
      controller.enqueue(chunk)
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('GET /api/fetch-image', () => {
  it('passes through an allowed content type without forwarding caller headers', async () => {
    const fetchMock = vi.fn(
      async () => new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/cat.png', {
      cookie: 'CF_Authorization=secret',
      authorization: 'Bearer secret',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES)

    // Only the upstream URL and the manual-redirect/timeout controls travel
    // through: no `headers` key at all, so none of the caller's cookies,
    // Authorization or `cf-*` headers can leak to a third party.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.redirect).toBe('manual')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.headers).toBeUndefined()
  })

  it('passes image/x-icon through with 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/x-icon' } })),
    )

    const response = await fetchImage(createTestEnv(), 'https://example.com/favicon.ico')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/x-icon')
  })

  it('rejects text/html with 415 and cancels the unread body', async () => {
    const cancelSpy = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel: cancelSpy }), {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/page.html')
    expect(response.status).toBe(415)
    expect(cancelSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects image/svg+xml with 415', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('<svg></svg>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }),
      ),
    )

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/pic.svg')
    expect(response.status).toBe(415)
  })

  it('rejects a redirect to a blocked host with 400, fetching only the one hop', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/redirect')
    expect(response.status).toBe(400)
    // The blocked target is never fetched: validation happens before the next hop.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a redirect to a non-http(s) scheme with 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: 'ftp://example.com/cat.png' } })),
    )

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/redirect')
    expect(response.status).toBe(400)
  })

  it('rejects a redirect with no location header with 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302 })))

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/redirect')
    expect(response.status).toBe(502)
  })

  it('resolves a relative Location against the redirecting URL', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (url.toString() === 'https://example.com/redirect') {
        return new Response(null, { status: 302, headers: { location: '/cat.png' } })
      }
      return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/redirect')
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]!.toString()).toBe('https://example.com/cat.png')
  })

  it('resolves a protocol-relative Location against the redirecting URL scheme', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (url.toString() === 'https://example.com/redirect') {
        return new Response(null, { status: 302, headers: { location: '//cdn.example.com/cat.png' } })
      }
      return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/redirect')
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]!.toString()).toBe('https://cdn.example.com/cat.png')
  })

  it('rejects more than 3 redirects with 502, having followed exactly the hop limit', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'https://example.com/next' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/start')
    expect(response.status).toBe(502)
    // The initial fetch plus 3 followed redirects, then one more that trips the limit.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('rejects a body over the cap sent without content-length with 413', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(oversizedStream(), { status: 200, headers: { 'content-type': 'image/png' } }),
      ),
    )

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/huge.png')
    expect(response.status).toBe(413)
  })

  it('maps a connection reset mid-body to 502, not an unhandled 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(4))
                controller.error(new Error('connection reset'))
              },
            }),
            { status: 200, headers: { 'content-type': 'image/png' } },
          ),
      ),
    )

    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/flaky.png')
    expect(response.status).toBe(502)
  })

  it('maps an upstream timeout to 502', async () => {
    vi.useFakeTimers()

    // `AbortSignal.timeout` schedules its own native timer that fake timers
    // cannot see, so it is replaced with an equivalent built on `setTimeout`,
    // which they can: this keeps the stub's abort behaviour, driven by the
    // fake clock, faithful to what the route actually depends on (`signal`).
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), ms)
      return controller.signal
    })

    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('the operation timed out')))
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const env = createTestEnv()
    const responsePromise = fetchImage(env, 'https://example.com/slow.png')
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 100)
    const response = await responsePromise
    expect(response.status).toBe(502)
    expect(AbortSignal.timeout).toHaveBeenCalledWith(FETCH_TIMEOUT_MS)
  })

  it('rejects an anonymous caller with 401', async () => {
    const env = createTestEnv()
    const response = await fetchImage(env, 'https://example.com/cat.png', ANON)
    expect(response.status).toBe(401)
  })
})
