import { describe, expect, it } from 'vitest'
import type { ApiErrorBody, MeResponse } from '../../src/shared/types'
import { ANON, call, createTestEnv } from '../support/env'

describe('GET /api/me', () => {
  it('reports the dev identity when no dev-anonymous header is sent', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/me')

    expect(response.status).toBe(200)
    const body = (await response.json()) as MeResponse
    expect(body).toMatchObject({ authenticated: true, email: 'dev@localhost', dev: true })
  })

  it('reports anonymous when the dev-anonymous header simulates a signed-out caller', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/me', { headers: ANON })

    const body = (await response.json()) as MeResponse
    expect(body.authenticated).toBe(false)
  })
})

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const env = createTestEnv()
    const response = await call(env, '/api/nope')

    expect(response.status).toBe(404)
    const body = (await response.json()) as ApiErrorBody
    expect(body.error).toBe('not_found')
  })
})
