import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { IMAGE_MAX_BYTES, WEBP_MAX_DIMENSION } from '../../shared/limits'
import type { ImageUploadResponse } from '../../shared/types'
import { requireIdentity } from '../auth'
import { readCappedBody } from '../body'
import { ownerOf, type HonoEnv } from '../http'
import { generateId, isValidId } from '../id'
import { isWebp } from '../webp'

export const imagesRoutes = new Hono<HonoEnv>()

interface ImageRow {
  id: string
  r2_key: string
  width: number
  height: number
  bytes: number
}

/** Rejects an oversized body by its declared length, before the bytes are read. */
function checkContentLength(request: Request): void {
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > IMAGE_MAX_BYTES) {
    throw new HTTPException(413, { message: 'image is too large' })
  }
}

function requireDimension(raw: string | undefined, name: string): number {
  if (!raw) throw new HTTPException(400, { message: `${name} header is required` })
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > WEBP_MAX_DIMENSION) {
    throw new HTTPException(400, { message: `${name} must be an integer in 1..${WEBP_MAX_DIMENSION}` })
  }
  return value
}

imagesRoutes.post('/api/images', requireIdentity, async (c) => {
  checkContentLength(c.req.raw)

  const contentType = c.req.header('content-type') ?? ''
  if ((contentType.split(';')[0] ?? '').trim() !== 'image/webp') {
    throw new HTTPException(415, { message: 'content-type must be image/webp' })
  }

  const width = requireDimension(c.req.header('x-image-width'), 'x-image-width')
  const height = requireDimension(c.req.header('x-image-height'), 'x-image-height')
  const sourceUrl = c.req.header('x-source-url') ?? null

  // The content-length header may be absent or wrong: streaming the body and
  // capping the running total is the only check that can be trusted, and it
  // also avoids buffering an oversized body in full before rejecting it.
  const bytes = await readCappedBody(c.req.raw.body, IMAGE_MAX_BYTES, 'image is too large')
  if (!isWebp(bytes)) {
    throw new HTTPException(415, { message: 'body is not a valid WebP image' })
  }

  const owner = ownerOf(c)
  const id = generateId()
  const r2Key = `img/${id}.webp`

  await c.env.IMAGES.put(r2Key, bytes, { httpMetadata: { contentType: 'image/webp' } })

  const now = Date.now()
  await c.env.DB.prepare(
    'INSERT INTO images (id, owner, r2_key, bytes, width, height, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, owner, r2Key, bytes.byteLength, width, height, sourceUrl, now)
    .run()

  const response: ImageUploadResponse = { id, url: `/img/${id}`, width, height, bytes: bytes.byteLength }
  return c.json(response, 201)
})

imagesRoutes.get('/img/:id', requireIdentity, async (c) => {
  const id = c.req.param('id')
  // Unknown ids and bad id formats are indistinguishable from "not found",
  // and the format check happens before R2 is ever touched.
  if (!isValidId(id)) throw new HTTPException(404, { message: 'image not found' })

  const owner = ownerOf(c)
  const row = await c.env.DB.prepare('SELECT id, r2_key, width, height, bytes FROM images WHERE id = ? AND owner = ?')
    .bind(id, owner)
    .first<ImageRow>()
  if (!row) throw new HTTPException(404, { message: 'image not found' })

  const object = await c.env.IMAGES.get(row.r2_key)
  if (!object) throw new HTTPException(404, { message: 'image not found' })

  const ifNoneMatch = c.req.header('if-none-match')
  if (ifNoneMatch && ifNoneMatch === object.httpEtag) {
    return c.body(null, 304, {
      etag: object.httpEtag,
      'cache-control': 'private, max-age=31536000, immutable',
    })
  }

  return c.body(object.body, 200, {
    'content-type': 'image/webp',
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    etag: object.httpEtag,
  })
})
