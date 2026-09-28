import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireIdentity } from '../auth'
import { ownerOf, type HonoEnv } from '../http'
import { isValidId } from '../id'
import { getNote } from '../notes-repo'

export const rawRoutes = new Hono<HonoEnv>()

/** RFC 5987 `attr-char`: everything else is percent-encoded byte by byte, which also covers multi-byte UTF-8. */
const ATTR_CHAR = /^[A-Za-z0-9\-_.~]$/

function encodeRfc5987(value: string): string {
  return Array.from(value)
    .map((char) => {
      if (ATTR_CHAR.test(char)) return char
      return Array.from(new TextEncoder().encode(char))
        .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
        .join('')
    })
    .join('')
}

/** A quoted-string fallback for clients that ignore `filename*`: non-ASCII and quote/backslash become `_`. */
function asciiFallbackFilename(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return ascii || 'note.md'
}

function contentDispositionHeader(filename: string): string {
  return `attachment; filename="${asciiFallbackFilename(filename)}"; filename*=UTF-8''${encodeRfc5987(filename)}`
}

rawRoutes.get('/raw/:id', requireIdentity, async (c) => {
  const id = c.req.param('id')
  // Unknown ids and bad id formats are indistinguishable from "not found".
  if (!isValidId(id)) throw new HTTPException(404, { message: 'note not found' })

  const owner = ownerOf(c)
  const note = await getNote(c.env.DB, owner, id)
  if (!note) throw new HTTPException(404, { message: 'note not found' })

  const content = note.title !== '' ? `# ${note.title}\n\n${note.body}` : note.body

  const headers: Record<string, string> = {
    'content-type': 'text/markdown; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  }

  if (c.req.query('download') !== undefined) {
    const filename = `${note.title !== '' ? note.title : note.id}.md`
    headers['content-disposition'] = contentDispositionHeader(filename)
  }

  return c.body(content, 200, headers)
})
