import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchImageProxy, fetchNote, onSessionLost } from './api'

const reportSessionLost = vi.fn()
onSessionLost(reportSessionLost)

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** What `fetch` resolves to for a redirect held back by `redirect: 'manual'`. */
function opaqueRedirect(): Response {
  const response = new Response(null, { status: 200 })
  Object.defineProperty(response, 'type', { value: 'opaqueredirect' })
  return response
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  reportSessionLost.mockClear()
})

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('session loss detection', () => {
  it('treats an Access redirect as an expired session', async () => {
    fetchMock.mockResolvedValue(opaqueRedirect())

    const error = await caught(fetchNote('n1'))

    expect(error.code).toBe('session_expired')
    expect(reportSessionLost).toHaveBeenCalledWith('expired')
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('manual')
  })

  it('asks for sign-out when the Worker refuses the token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'session_stale', message: 'refused' }))

    await caught(fetchNote('n1'))

    expect(reportSessionLost).toHaveBeenCalledWith('stale')
  })

  it('asks for sign-in on a plain 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'unauthorized', message: 'no token' }))

    await caught(fetchNote('n1'))

    expect(reportSessionLost).toHaveBeenCalledWith('expired')
  })

  it('leaves a network failure and other errors alone', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'not_found', message: 'gone' }))

    expect((await caught(fetchNote('n1'))).code).toBe('network')
    expect((await caught(fetchNote('n1'))).code).toBe('not_found')
    expect(reportSessionLost).not.toHaveBeenCalled()
  })

  it('applies to the image proxy too', async () => {
    fetchMock.mockResolvedValue(opaqueRedirect())

    await caught(fetchImageProxy('https://example.com/a.png'))

    expect(reportSessionLost).toHaveBeenCalledWith('expired')
  })
})
