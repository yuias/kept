import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, ImageUploadResponse } from '../../src/shared/types'
import { generateId } from '../../src/worker/id'
import { ANON, call, createTestEnv } from '../support/env'

const OTHER_OWNER = 'other@example.com'

const MINIMAL_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  0x0e, 0x00, 0x00, 0x00, 0x10, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00,
  0x34, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0xfe, 0xfb, 0xfd, 0x50, 0x00,
])

function uploadImage(
  env: Parameters<typeof call>[0],
  body: BodyInit,
  headers: Record<string, string> = {},
): Promise<Response> {
  return call(env, '/api/images', {
    method: 'POST',
    headers: {
      'content-type': 'image/webp',
      'x-image-width': '1',
      'x-image-height': '1',
      ...headers,
    },
    body,
  })
}

async function uploadImageOk(env: Parameters<typeof call>[0]): Promise<ImageUploadResponse> {
  const response = await uploadImage(env, MINIMAL_WEBP.slice())
  expect(response.status).toBe(201)
  return (await response.json()) as ImageUploadResponse
}

/** Inserts an image row and R2 object directly, bypassing the API, to simulate another owner's data. */
async function insertImage(env: Parameters<typeof call>[0], owner: string): Promise<string> {
  const id = generateId()
  const r2Key = `img/${id}.webp`
  await env.IMAGES.put(r2Key, MINIMAL_WEBP.slice().buffer, { httpMetadata: { contentType: 'image/webp' } })
  await env.DB.prepare(
    'INSERT INTO images (id, owner, r2_key, bytes, width, height, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, owner, r2Key, MINIMAL_WEBP.byteLength, 1, 1, null, Date.now())
    .run()
  return id
}

describe('POST /api/images', () => {
  it('accepts a minimal valid WebP and stores it in R2', async () => {
    const env = createTestEnv()
    const uploaded = await uploadImageOk(env)

    expect(uploaded.width).toBe(1)
    expect(uploaded.height).toBe(1)
    expect(uploaded.url).toBe(`/img/${uploaded.id}`)

    const object = await env.IMAGES.get(`img/${uploaded.id}.webp`)
    expect(object).not.toBeNull()
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(MINIMAL_WEBP)
  })

  it('rejects a body that is not actually WebP with 415', async () => {
    const env = createTestEnv()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const response = await uploadImage(env, png)
    expect(response.status).toBe(415)
  })

  it('rejects an over-cap content-length header with 413', async () => {
    const env = createTestEnv()
    const response = await uploadImage(env, MINIMAL_WEBP.slice(), { 'content-length': String(9 * 1024 * 1024) })
    expect(response.status).toBe(413)
  })

  it('rejects an over-cap body sent without content-length with 413', async () => {
    const env = createTestEnv()
    const oversized = new Uint8Array(9 * 1024 * 1024)
    oversized.set(MINIMAL_WEBP, 0)
    const response = await call(env, '/api/images', {
      // A Request built from a plain byte body carries no content-length
      // header at all, so only the byte-length check after reading it fires.
      method: 'POST',
      headers: { 'content-type': 'image/webp', 'x-image-width': '1', 'x-image-height': '1' },
      body: oversized,
    })
    expect(response.status).toBe(413)
  })

  it('rejects an over-cap chunked ReadableStream body without content-length with 413', async () => {
    const env = createTestEnv()
    const chunkCount = 20
    const chunkSize = Math.ceil((9 * 1024 * 1024) / chunkCount)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < chunkCount; i++) controller.enqueue(new Uint8Array(chunkSize))
        controller.close()
      },
    })

    const response = await call(env, '/api/images', {
      method: 'POST',
      headers: { 'content-type': 'image/webp', 'x-image-width': '1', 'x-image-height': '1' },
      body: stream,
      // A streamed body needs an explicit opt-in under Node's fetch implementation.
      duplex: 'half',
    } as RequestInit)
    expect(response.status).toBe(413)
  })

  it('rejects non-integer or out-of-range dimensions with 400', async () => {
    const env = createTestEnv()
    const response = await uploadImage(env, MINIMAL_WEBP.slice(), { 'x-image-width': '0' })
    expect(response.status).toBe(400)

    const response2 = await uploadImage(env, MINIMAL_WEBP.slice(), { 'x-image-width': 'not-a-number' })
    expect(response2.status).toBe(400)
  })

  it('rejects an anonymous caller with 401', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/images', {
      method: 'POST',
      headers: { 'content-type': 'image/webp', 'x-image-width': '1', 'x-image-height': '1', ...ANON },
      body: MINIMAL_WEBP.slice(),
    })
    expect(response.status).toBe(401)
  })
})

describe('GET /img/:id', () => {
  it('returns the same bytes with content-type image/webp and a private cache-control', async () => {
    const env = createTestEnv()
    const uploaded = await uploadImageOk(env)

    const response = await call(env, `/img/${uploaded.id}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(MINIMAL_WEBP)
  })

  it('returns 304 when if-none-match matches the etag', async () => {
    const env = createTestEnv()
    const uploaded = await uploadImageOk(env)

    const first = await call(env, `/img/${uploaded.id}`)
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()

    const second = await call(env, `/img/${uploaded.id}`, { headers: { 'if-none-match': etag! } })
    expect(second.status).toBe(304)
  })

  it('reports another owner\'s image as 404', async () => {
    const env = createTestEnv()
    const otherImageId = await insertImage(env, OTHER_OWNER)

    const response = await call(env, `/img/${otherImageId}`)
    expect(response.status).toBe(404)
  })

  it('rejects a bad id format with 404', async () => {
    const env = createTestEnv()
    const response = await call(env, '/img/not-a-valid-id')
    expect(response.status).toBe(404)
    const errorBody = (await response.json()) as ApiErrorBody
    expect(errorBody.error).toBe('not_found')
  })

  it('rejects an anonymous caller with 401', async () => {
    const env = createTestEnv()
    const uploaded = await uploadImageOk(env)

    const response = await call(env, `/img/${uploaded.id}`, { headers: ANON })
    expect(response.status).toBe(401)
  })
})
