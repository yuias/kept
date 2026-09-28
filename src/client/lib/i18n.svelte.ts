import { en, type Messages } from '../locales/en'
import { ja } from '../locales/ja'

export const LOCALES = ['en', 'ja'] as const

export type Locale = (typeof LOCALES)[number]

/** Used whenever the browser asks for something we do not ship. */
export const DEFAULT_LOCALE: Locale = 'en'

const CATALOGS: Record<Locale, Messages> = { en, ja }

const STORAGE_KEY = 'kept.locale'

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Mirrors what `Accept-Language` would give the server. The SPA shell is served
 * straight from static assets, so the Worker never sees the navigation that
 * renders it; `navigator.languages` carries the same preference list.
 */
function detectLocale(): Locale {
  const preferences = navigator.languages?.length ? navigator.languages : [navigator.language]

  for (const tag of preferences) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

function readStoredOverride(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isLocale(stored) ? stored : null
  } catch {
    // Private browsing modes can throw on access; fall back to detection.
    return null
  }
}

const state = $state<{ override: Locale | null; detected: Locale }>({
  override: readStoredOverride(),
  detected: detectLocale(),
})

/** The locale actually in use, after applying any manual override. */
export function locale(): Locale {
  return state.override ?? state.detected
}

/** The manual choice, or null while following the browser preference. */
export function localeOverride(): Locale | null {
  return state.override
}

export function messages(): Messages {
  return CATALOGS[locale()]
}

/** Pass null to go back to following the browser's preference. */
export function setLocaleOverride(next: Locale | null): void {
  state.override = next

  try {
    if (next) localStorage.setItem(STORAGE_KEY, next)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Persisting is best-effort; the choice still applies to this session.
  }

  syncDocumentLanguage()
}

/** Keeps `<html lang>` in step so screen readers and browsers agree. */
export function syncDocumentLanguage(): void {
  document.documentElement.lang = CATALOGS[locale()].meta.htmlLang
}
