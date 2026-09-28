import type { ImageUploadResponse } from '../../../shared/types'
import { ApiError, fetchImageProxy, uploadImage } from '../api'
import EncodeWorker from './encode.worker.ts?worker'
import type { EncodeRequest, EncodeResponse } from './encode.worker'

export interface EncodeResult {
  webp: ArrayBuffer
  width: number
  height: number
}

interface PendingRequest {
  resolve: (result: EncodeResult) => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let nextRequestId = 0
const pending = new Map<number, PendingRequest>()

/** The worker (and the wasm it loads) is only created on the first encode. */
function getWorker(): Worker {
  if (worker) return worker

  const created = new EncodeWorker()
  created.onmessage = (event: MessageEvent<EncodeResponse>) => {
    const message = event.data
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)

    if (message.ok) entry.resolve({ webp: message.webp, width: message.width, height: message.height })
    else entry.reject(new ApiError(0, 'image_encode_failed', message.error))
  }
  created.onerror = (event: ErrorEvent) => {
    // A worker-level failure (e.g. the wasm module failed to load) carries no
    // request id, so every request still in flight fails together.
    for (const entry of pending.values()) entry.reject(new ApiError(0, 'image_encode_failed', event.message))
    pending.clear()
  }

  worker = created
  return created
}

/** Decodes `blob` off the main thread and re-encodes it as WebP. */
export function encodeToWebp(blob: Blob): Promise<EncodeResult> {
  const id = nextRequestId++
  const workerInstance = getWorker()

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const request: EncodeRequest = { id, blob }
    workerInstance.postMessage(request)
  })
}

export function uploadWebp(result: EncodeResult, sourceUrl?: string): Promise<ImageUploadResponse> {
  return uploadImage(result.webp, result.width, result.height, sourceUrl)
}

/** Fetches an external image through the server-side proxy, then encodes and uploads it. */
export async function importFromUrl(url: string): Promise<ImageUploadResponse> {
  const blob = await fetchImageProxy(url)
  const result = await encodeToWebp(blob)
  return uploadWebp(result, url)
}
