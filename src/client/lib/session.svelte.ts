import type { MeResponse } from '../../shared/types'

const ANONYMOUS: MeResponse = {
  email: '',
  name: '',
  authenticated: false,
  stale: false,
  dev: false,
}

const state = $state<{ me: MeResponse; loaded: boolean }>({ me: ANONYMOUS, loaded: false })

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
