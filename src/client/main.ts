import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { syncDocumentLanguage } from './lib/i18n.svelte'
import { syncDocumentTheme } from './lib/theme.svelte'
// Imported for its side effect: starts the identity lookup before the first render.
import './lib/session.svelte'
import { encodeToWebp, importFromUrl, uploadWebp } from './lib/image/pipeline'

// Exposed for manual testing from the browser console (see T29's manual
// acceptance check) and, as a side effect of assigning to `window`, keeps
// the encode worker and its wasm in the production build graph until the
// editor (T30) imports the pipeline directly. Remove once that wiring lands.
Object.assign(window, { encodeToWebp, importFromUrl, uploadWebp })

syncDocumentLanguage()
// `index.html` already applied the stored theme; this only keeps the document
// correct if that snippet is ever missing.
syncDocumentTheme()

const target = document.getElementById('app')
if (!target) throw new Error('#app mount point is missing')

export default mount(App, { target })
