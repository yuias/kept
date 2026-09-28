import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types'
import { fetchSettings, updateSettings as putSettings } from './api'

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

/** PUTs the patch and, on success, updates the store from the server's response. */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const updated = await putSettings(patch)
  state.settings = updated
  return updated
}
