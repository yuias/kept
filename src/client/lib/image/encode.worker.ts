// Runs in a dedicated Web Worker so the wasm decode/encode work never blocks
// the UI thread. Deliberately typed against the DOM lib (see vite-env.d.ts):
// `self`, `postMessage`, `createImageBitmap` and `OffscreenCanvas` are all
// declared there too, and pulling in the `webworker` lib would collide with
// the rest of the client tree, which is compiled against `DOM`.
// The `/encode` subpath is used instead of the package root so this worker
// never pulls in the decoder's wasm, which it has no use for.
import encode from '@jsquash/webp/encode'
import { IMAGE_MAX_EDGE, IMAGE_WEBP_QUALITY } from '../../../shared/limits'
import { scaleToMaxEdge } from './dimensions'

export interface EncodeRequest {
  id: number
  blob: Blob
}

export type EncodeResponse =
  | { id: number; ok: true; webp: ArrayBuffer; width: number; height: number }
  | { id: number; ok: false; error: string }

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { id, blob } = event.data

  try {
    const bitmap = await createImageBitmap(blob)
    const { width, height } = scaleToMaxEdge(bitmap.width, bitmap.height, IMAGE_MAX_EDGE)

    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2d canvas context is unavailable')

    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const imageData = context.getImageData(0, 0, width, height)
    const webp = await encode(imageData, { quality: IMAGE_WEBP_QUALITY })

    const response: EncodeResponse = { id, ok: true, webp, width, height }
    // Transferring the buffer avoids a copy back to the main thread.
    self.postMessage(response, { transfer: [webp] })
  } catch (error) {
    const response: EncodeResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
