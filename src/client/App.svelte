<script lang="ts">
  import { untrack } from 'svelte'
  import TopBar from './components/TopBar.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import NotesView from './routes/NotesView.svelte'
  import SettingsPage from './routes/SettingsPage.svelte'
  import { messages } from './lib/i18n.svelte'
  import { closeMenu } from './lib/menu.svelte'
  import { currentRoute } from './lib/router.svelte'
  import { listQueryFor } from './lib/routes'

  const route = $derived(currentRoute())
  const query = $derived(listQueryFor(route))
  const m = $derived(messages())

  // Every navigation, note open and Back press reassigns the route object.
  $effect(() => {
    void route
    untrack(closeMenu)
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
