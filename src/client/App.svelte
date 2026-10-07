<script lang="ts">
  import { untrack } from 'svelte'
  import TopBar from './components/TopBar.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import NotesView from './routes/NotesView.svelte'
  import SettingsPage from './routes/SettingsPage.svelte'
  import SessionLostDialog from './components/SessionLostDialog.svelte'
  import { messages } from './lib/i18n.svelte'
  import { closeMenu } from './lib/menu.svelte'
  import { closeDrawer } from './lib/sidebar.svelte'
  import { currentRoute } from './lib/router.svelte'
  import { listQueryFor } from './lib/routes'
  import { sessionLoss } from './lib/session.svelte'

  const route = $derived(currentRoute())
  const query = $derived(listQueryFor(route))
  const m = $derived(messages())
  const loss = $derived(sessionLoss())

  // Every navigation, note open and Back press reassigns the route object,
  // and each one also closes the phone drawer.
  $effect(() => {
    void route
    untrack(() => {
      closeMenu()
      closeDrawer()
    })
  })
</script>

<div class="app">
  <TopBar />
  <div class="layout">
    <Sidebar />
    <main>
      {#if query}
        <NotesView {query} />
      {:else if route.name === 'settings'}
        <SettingsPage />
      {:else}
        <p>{m.app.notFound}</p>
      {/if}
    </main>
  </div>
</div>

{#if loss}
  <SessionLostDialog kind={loss} />
{/if}
