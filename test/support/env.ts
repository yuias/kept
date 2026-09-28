import { app } from '../../src/worker/app'
import type { AppEnv } from '../../src/worker/http'
import { createD1 } from './d1'
import { createR2 } from './r2'

/** A fresh in-memory env for one test: its own D1 and R2, plus dummy Access config. */
export function createTestEnv(): AppEnv {
  return {
    DB: createD1(),
    IMAGES: createR2(),
    BACKUPS: createR2(),
    ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
    ACCESS_POLICY_AUD: 'test-audience',
    ALLOWED_EMAILS: '',
  } as unknown as AppEnv
}

/** Routes a request through the Hono app the way the real Worker would. */
export function call(env: AppEnv, path: string, init?: RequestInit): Promise<Response> {
  return app.request(path, init, env)
}

/** Sent with a request to simulate an anonymous caller under `import.meta.env.DEV`. */
export const ANON: HeadersInit = { 'x-dev-anonymous': '1' }
