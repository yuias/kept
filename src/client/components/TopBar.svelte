<script lang="ts">
  import { messages } from '../lib/i18n.svelte'
  import { currentRoute, navigate, openNote } from '../lib/router.svelte'
  import { listQueryFor } from '../lib/routes'
  import { session } from '../lib/session.svelte'
  import SearchBox from './SearchBox.svelte'
  import ThemeToggle from './ThemeToggle.svelte'
  import { sidebarOpen, toggleSidebar } from '../lib/sidebar.svelte'

  const me = $derived(session())
  const m = $derived(messages())

  /** From a route with no note grid (Settings, notfound), open the dialog on the notes list instead. */
  function handleNewNote(): void {
    if (listQueryFor(currentRoute())) openNote('new')
    else navigate('/?note=new')
  }

  /**
   * Cloudflare Access answers both of these itself; neither reaches the Worker,
   * and both must be plain navigations rather than SPA routing. Signing out is
   * also how a user switches between the available login methods.
   */
  const SIGN_IN_URL = '/'
  const SIGN_OUT_URL = '/cdn-cgi/access/logout'
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
  <button type="button" onclick={handleNewNote}>{m.editor.newNote}</button>
  <ThemeToggle />
  {#if me.loaded}
    <span class="identity" class:stale={me.me.stale}>
      {#if me.me.authenticated}
        {me.me.email}{#if me.me.dev}
          <span class="badge">{m.nav.dev}</span>
        {/if}
      {:else if me.me.stale}
        {m.nav.sessionStale}
      {:else}
        {m.nav.notSignedIn}
      {/if}
    </span>
    <!-- Access is not in front of the Worker in dev, so neither URL exists. -->
    {#if !me.me.dev}
      <!-- A stale token gets signing out, not signing in: Access would wave
           the same token through and land the reader right back here. -->
      {#if me.me.authenticated || me.me.stale}
        <a class="auth-link" href={SIGN_OUT_URL}>{m.nav.signOut}</a>
      {:else}
        <a class="auth-link" href={SIGN_IN_URL}>{m.nav.signIn}</a>
      {/if}
    {/if}
  {/if}
</header>
