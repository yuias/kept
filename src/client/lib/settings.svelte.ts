import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types'
import { fetchSettings } from './api'

const state = $state<{ settings: AppSettings; loaded: boolean }>({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
})

async function load(): Promise<void> {
  try {
    state.settings = await fetchSettings()
  } catch {
    // Keep the defaults; the editor still needs *some* effective format
    // to fall back to while signed out or offline.
  } finally {
    state.loaded = true
  }
}

/** Settles once the initial load has finished, successfully or not. */
export const settingsReady: Promise<void> = load()

export function settings(): AppSettings {
  return state.settings
}
