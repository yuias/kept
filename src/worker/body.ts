import { HTTPException } from 'hono/http-exception'

/**
 * Reads a body a chunk at a time and aborts as soon as the running total
 * exceeds `maxBytes`, so an oversized body with no (or a lying) content-length
 * never sits fully buffered in memory before being rejected. Shared between
 * the upload route (a request body) and the fetch proxy (an upstream
 * response body), since both are just `ReadableStream<Uint8Array>`.
 */
export async function readCappedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0)

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new HTTPException(413, { message: tooLargeMessage })
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}
