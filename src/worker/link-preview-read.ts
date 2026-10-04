import { HeadCollector, type RawHead } from './link-preview-head'

/**
 * Streams at most `maxBytes` of `response` through HTMLRewriter and stops at
 * </head> (or the first <body>), returning what the collector saw. Truncation
 * is silent: a page whose head is cut off still yields what was read.
 */
export async function readHead(response: Response, maxBytes: number): Promise<RawHead> {
  const collector = new HeadCollector()
  let done = false

  if (response.body === null) return collector.result()

  let total = 0
  const cap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (total + chunk.byteLength > maxBytes) {
        if (maxBytes > total) controller.enqueue(chunk.subarray(0, maxBytes - total))
        total = maxBytes
        // Ending the stream makes pipeThrough cancel the upstream body.
        controller.terminate()
        return
      }
      total += chunk.byteLength
      controller.enqueue(chunk)
    },
  })

  // Only content-type is carried over, for the charset: the body is already
  // decoded and may be truncated, so length/encoding headers would be wrong.
  const contentType = response.headers.get('content-type')
  const capped = new Response(response.body.pipeThrough(cap), {
    headers: contentType ? { 'content-type': contentType } : {},
  })

  const rewritten = new HTMLRewriter()
    .on('meta', {
      element(el) {
        collector.meta(el.getAttribute('property'), el.getAttribute('name'), el.getAttribute('content'))
      },
    })
    .on('title', {
      text(chunk) {
        collector.titleText(chunk.text, chunk.lastInTextNode)
      },
    })
    .on('link', {
      element(el) {
        collector.link(el.getAttribute('rel'), el.getAttribute('href'))
      },
    })
    .on('head', {
      element(el) {
        el.onEndTag(() => {
          done = true
        })
      },
    })
    .on('body', {
      element() {
        done = true
      },
    })
    .transform(capped)

  const reader = rewritten.body?.getReader()
  if (!reader) return collector.result()

  try {
    while (!done) {
      const { done: ended } = await reader.read()
      if (ended) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  return collector.result()
}
