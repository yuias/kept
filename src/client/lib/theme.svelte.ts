import type { Messages } from '../locales/en'

const STORED_THEMES = ['light', 'dark'] as const

type StoredTheme = (typeof STORED_THEMES)[number]

export type ThemeMode = 'system' | StoredTheme

export const THEME_CYCLE: readonly ThemeMode[] = ['system', 'light', 'dark']

/** Shared with the pre-paint snippet in `index.html`. */
const STORAGE_KEY = 'kept.theme'

function isStoredTheme(value: unknown): value is StoredTheme {
  return typeof value === 'string' && (STORED_THEMES as readonly string[]).includes(value)
}

function readStoredOverride(): StoredTheme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isStoredTheme(stored) ? stored : null
  } catch {
    // Private browsing modes can throw on access; fall back to the OS setting.
    return null
  }
}

const state = $state<{ override: StoredTheme | null }>({ override: readStoredOverride() })

/** The mode in effect: the manual choice, or `system` while following the OS setting. */
export function theme(): ThemeMode {
  return state.override ?? 'system'
}

/** Pass `system` to go back to following the OS setting. */
export function setTheme(next: ThemeMode): void {
  state.override = next === 'system' ? null : next

  try {
    if (state.override) localStorage.setItem(STORAGE_KEY, state.override)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Persisting is best-effort; the choice still applies to this session.
  }

  syncDocumentTheme()
}

/**
 * The palette itself is `light-dark()` in CSS, so a manual choice only has to
 * pin `color-scheme` — which `:root[data-theme]` does. Removing the attribute
 * hands the decision back to `prefers-color-scheme`.
 */
export function syncDocumentTheme(): void {
  const root = document.documentElement
  if (state.override) root.dataset.theme = state.override
  else delete root.dataset.theme
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  const index = THEME_CYCLE.indexOf(mode)
  // `indexOf` never misses: `mode` is a `ThemeMode`, so the fallback is unreachable.
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length] ?? 'system'
}

export function themeLabel(mode: ThemeMode, m: Messages): string {
  if (mode === 'light') return m.nav.themeLight
  if (mode === 'dark') return m.nav.themeDark
  return m.nav.themeAuto
}
