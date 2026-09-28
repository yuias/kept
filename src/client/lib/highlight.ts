import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { bundledLanguages, type BundledLanguage } from 'shiki/langs'
import { bundledThemes } from 'shiki/themes'

const LIGHT_THEME = 'github-light'
const DARK_THEME = 'github-dark'

/** Shiki resolves these without a grammar download. */
const PLAIN_LANGUAGES = new Set(['text', 'plaintext', 'txt', 'plain', ''])

let highlighterPromise: Promise<HighlighterCore> | null = null
const languageLoads = new Map<string, Promise<void>>()

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [bundledThemes[LIGHT_THEME]!, bundledThemes[DARK_THEME]!],
    langs: [],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  })
  return highlighterPromise
}

function isBundled(id: string): id is BundledLanguage {
  return id in bundledLanguages
}

/** Resolves the requested language to one Shiki actually bundles. */
export function resolveLanguage(language: string): BundledLanguage | 'text' {
  const id = language.toLowerCase()
  if (PLAIN_LANGUAGES.has(id)) return 'text'
  return isBundled(id) ? id : 'text'
}

async function ensureLanguage(
  highlighter: HighlighterCore,
  language: BundledLanguage | 'text',
): Promise<void> {
  if (language === 'text') return

  // Grammars are shared across every code block, so de-duplicate in-flight loads.
  let load = languageLoads.get(language)
  if (!load) {
    load = highlighter.loadLanguage(bundledLanguages[language]).then(() => undefined)
    languageLoads.set(language, load)
  }
  await load
}

/**
 * Returns Shiki-generated HTML for `code`. Both themes are emitted as CSS
 * custom properties so switching color schemes needs no re-highlighting.
 */
export async function highlightToHtml(code: string, language: string): Promise<string> {
  const resolved = resolveLanguage(language)
  const highlighter = await getHighlighter()
  await ensureLanguage(highlighter, resolved)

  return highlighter.codeToHtml(code, {
    lang: resolved,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false,
    cssVariablePrefix: '--shiki-',
  })
}
