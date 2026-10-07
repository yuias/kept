import type { MeResponse } from '../../shared/types'
import { type SessionLoss, onSessionLost } from './api'

export type { SessionLoss }

const ANONYMOUS: MeResponse = {
  email: '',
  name: '',
  authenticated: false,
  stale: false,
  dev: false,
}

/**
 * Cloudflare Access answers both of these itself; neither reaches the Worker,
 * and both must be plain navigations rather than SPA routing. Signing out is
 * also how a user switches between the available login methods.
 */
export const SIGN_IN_URL = '/'
export const SIGN_OUT_URL = '/cdn-cgi/access/logout'

const state = $state<{ me: MeResponse; loaded: boolean }>({ me: ANONYMOUS, loaded: false })

const loss = $state<{ kind: SessionLoss | null }>({ kind: null })

async function fetchMe(): Promise<MeResponse> {
  const response = await fetch('/api/me')
  if (!response.ok) throw new Error(`GET /api/me: ${response.status}`)
  return (await response.json()) as MeResponse
}

/**
 * Resolves the current identity once per page load. On Access-bypassed pages
 * `/api/me` is unreachable and the request fails, which simply means
 * "anonymous reader".
 */
async function load(): Promise<void> {
  try {
    state.me = await fetchMe()
    if (state.me.stale) reportSessionLost('stale')
  } catch {
    state.me = ANONYMOUS
  } finally {
    state.loaded = true
  }
}

/** Settles once the identity lookup has finished, successfully or not. */
export const sessionReady: Promise<void> = load()

export function session(): { me: MeResponse; loaded: boolean } {
  return state
}

export function sessionLoss(): SessionLoss | null {
  return loss.kind
}

/** Called for every request that fails for lack of a usable session. */
export function reportSessionLost(kind: SessionLoss): void {
  loss.kind = kind
}

onSessionLost(reportSessionLost)

/** Hides the prompt until the next failing request reports the loss again. */
export function dismissSessionLoss(): void {
  loss.kind = null
}
