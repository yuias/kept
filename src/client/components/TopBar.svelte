<script lang="ts">
  import { messages } from '../lib/i18n.svelte'
  import { currentRoute, navigate, openNote } from '../lib/router.svelte'
  import { listQueryFor } from '../lib/routes'
  import AccountStatus from './AccountStatus.svelte'
  import SearchBox from './SearchBox.svelte'
  import ThemeToggle from './ThemeToggle.svelte'
  import { sidebarOpen, toggleSidebar } from '../lib/sidebar.svelte'

  const m = $derived(messages())

  /** From a route with no note grid (Settings, notfound), open the dialog on the notes list instead. */
  function handleNewNote(): void {
    if (listQueryFor(currentRoute())) openNote('new')
    else navigate('/?note=new')
  }
</script>

<header class="top-bar">
  <button
    class="hamburger"
    type="button"
    aria-label={m.nav.toggleSidebar}
    aria-expanded={sidebarOpen()}
    onclick={toggleSidebar}
  >
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  </button>
  <span class="brand">kept</span>
  <div class="top-bar-slot">
    <SearchBox />
  </div>
  <button type="button" class="new-note" aria-label={m.editor.newNote} onclick={handleNewNote}>
    <span class="new-note-icon" aria-hidden="true">+</span>
    <span class="new-note-label">{m.editor.newNote}</span>
  </button>
  <div class="top-bar-account">
    <ThemeToggle />
    <AccountStatus />
  </div>
</header>
