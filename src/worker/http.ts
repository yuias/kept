import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export interface Identity {
  email: string
  name: string
}

/**
 * Explicit so type-checking does not depend on `.dev.vars` being present: the
 * secrets are declared here even though `wrangler types` would also infer them
 * from a local config.
 */
export type AppEnv = Env & {
  ACCESS_TEAM_DOMAIN: string
  ACCESS_POLICY_AUD: string
  ALLOWED_EMAILS: string
  D1_EXPORT_API_TOKEN?: string
}

export interface HonoEnv {
  Bindings: AppEnv
  Variables: {
    /** Set by `withIdentity`; null when the request is anonymous. */
    identity: Identity | null
    /** Set by `withIdentity`; true when a token was presented but refused. */
    authStale: boolean
  }
}

/** Carries a stable error code alongside the HTTP status, for `onError` to surface. */
export class ApiException extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(status, { message })
  }
}

/** The owner key for every scoped query: the Access email, lower-cased. */
export function ownerOf(c: Context<HonoEnv>): string {
  return c.get('identity')!.email.toLowerCase()
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ApiException(400, 'bad_request', 'body must be valid JSON')
  }
}
