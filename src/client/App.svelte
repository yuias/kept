<script lang="ts">
  import TopBar from './components/TopBar.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import NotesView from './routes/NotesView.svelte'
  import SettingsPage from './routes/SettingsPage.svelte'
  import { messages } from './lib/i18n.svelte'
  import { currentRoute } from './lib/router.svelte'
  import { listQueryFor } from './lib/routes'

  const route = $derived(currentRoute())
  const query = $derived(listQueryFor(route))
  const m = $derived(messages())
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
