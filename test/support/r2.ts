import { createHash } from 'node:crypto'

interface StoredObject {
  key: string
  body: ArrayBuffer
  httpMetadata?: Record<string, string>
  customMetadata?: Record<string, string>
  uploaded: Date
  etag: string
}

async function toArrayBuffer(value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null): Promise<ArrayBuffer> {
  if (value === null) return new ArrayBuffer(0)
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer as ArrayBuffer
  if (value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
  if (value instanceof Blob) return await value.arrayBuffer()

  // A ReadableStream: drain it into one buffer.
  const reader = value.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value: chunk } = await reader.read()
    if (done) break
    chunks.push(chunk as Uint8Array)
    total += (chunk as Uint8Array).byteLength
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer as ArrayBuffer
}

function etagFor(body: ArrayBuffer): string {
  return createHash('md5').update(Buffer.from(body)).digest('hex')
}

function writeHttpMetadataOnto(headers: Headers, httpMetadata: Record<string, string> | undefined): void {
  if (!httpMetadata) return
  if (httpMetadata.contentType) headers.set('content-type', httpMetadata.contentType)
  if (httpMetadata.contentLanguage) headers.set('content-language', httpMetadata.contentLanguage)
  if (httpMetadata.contentDisposition) headers.set('content-disposition', httpMetadata.contentDisposition)
  if (httpMetadata.contentEncoding) headers.set('content-encoding', httpMetadata.contentEncoding)
  if (httpMetadata.cacheControl) headers.set('cache-control', httpMetadata.cacheControl)
}

function toR2Object(entry: StoredObject) {
  return {
    key: entry.key,
    version: entry.etag,
    size: entry.body.byteLength,
    etag: entry.etag,
    httpEtag: `"${entry.etag}"`,
    uploaded: entry.uploaded,
    httpMetadata: entry.httpMetadata,
    customMetadata: entry.customMetadata ?? {},
    writeHttpMetadata(headers: Headers) {
      writeHttpMetadataOnto(headers, entry.httpMetadata)
    },
  }
}

function toR2ObjectBody(entry: StoredObject) {
  return {
    ...toR2Object(entry),
    get body(): ReadableStream {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(entry.body))
          controller.close()
        },
      })
    },
    bodyUsed: false,
    arrayBuffer: async () => entry.body,
    bytes: async () => new Uint8Array(entry.body),
    text: async () => new TextDecoder().decode(entry.body),
    json: async <T>() => JSON.parse(new TextDecoder().decode(entry.body)) as T,
    blob: async () => new Blob([entry.body]),
  }
}

export function createR2(): R2Bucket {
  const store = new Map<string, StoredObject>()

  const bucket = {
    async head(key: string) {
      const entry = store.get(key)
      return entry ? toR2Object(entry) : null
    },
    async get(key: string) {
      const entry = store.get(key)
      return entry ? toR2ObjectBody(entry) : null
    },
    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
      options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> },
    ) {
      const body = await toArrayBuffer(value)
      const entry: StoredObject = {
        key,
        body,
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
        uploaded: new Date(),
        etag: etagFor(body),
      }
      store.set(key, entry)
      return toR2Object(entry)
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key)
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? ''
      const objects = [...store.values()].filter((entry) => entry.key.startsWith(prefix)).map(toR2Object)
      return { objects, truncated: false as const, delimitedPrefixes: [] }
    },
  }

  return bucket as unknown as R2Bucket
}
