import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { MeResponse } from '../shared/types'
import { isDevMode, withIdentity } from './auth'
import { ApiException, type HonoEnv } from './http'
import { fetchImageRoutes } from './routes/fetch-image'
import { foldersRoutes } from './routes/folders'
import { imagesRoutes } from './routes/images'
import { notesRoutes } from './routes/notes'
import { settingsRoutes } from './routes/settings'

export const app = new Hono<HonoEnv>()

app.use('*', withIdentity)

app.get('/api/me', (c) => {
  const identity = c.get('identity')
  const body: MeResponse = {
    email: identity?.email ?? '',
    name: identity?.name ?? '',
    authenticated: identity !== null,
    stale: c.get('authStale'),
    dev: isDevMode,
  }
  return c.json(body)
})

app.route('/', notesRoutes)
app.route('/', settingsRoutes)
app.route('/', foldersRoutes)
app.route('/', imagesRoutes)
app.route('/', fetchImageRoutes)

app.notFound((c) => c.json({ error: 'not_found', message: 'no such endpoint' }, 404))

app.onError((error, c) => {
  const status = error instanceof HTTPException ? error.status : 500
  const message = error instanceof HTTPException ? error.message : 'internal error'

  if (status >= 500) console.error(error)

  // A refused token needs its own code: the client's way out is to sign out,
  // not to sign in, and only the middleware knows which of the two it was.
  const code =
    error instanceof ApiException
      ? error.code
      : status === 401 && c.get('authStale')
        ? 'session_stale'
        : statusToCode(status)

  return c.json({ error: code, message }, status)
})

function statusToCode(status: number): string {
  if (status === 400) return 'bad_request'
  if (status === 401) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 413) return 'payload_too_large'
  if (status === 415) return 'unsupported_media_type'
  if (status === 502) return 'bad_gateway'
  return 'internal_error'
}
