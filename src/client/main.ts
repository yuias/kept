import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { syncDocumentLanguage } from './lib/i18n.svelte'
import { syncDocumentTheme } from './lib/theme.svelte'
// Imported for its side effect: starts the identity lookup before the first render.
import './lib/session.svelte'

syncDocumentLanguage()
// `index.html` already applied the stored theme; this only keeps the document
// correct if that snippet is ever missing.
syncDocumentTheme()

const target = document.getElementById('app')
if (!target) throw new Error('#app mount point is missing')

export default mount(App, { target })
