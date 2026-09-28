<script lang="ts">
  import { messages } from '../lib/i18n.svelte'
  import { currentRoute, link } from '../lib/router.svelte'
  import { sidebarOpen } from '../lib/sidebar.svelte'

  const m = $derived(messages())
  const route = $derived(currentRoute())
</script>

{#if sidebarOpen()}
  <nav class="sidebar">
    <a class="sidebar-link" href="/" use:link aria-current={route.name === 'notes' ? 'page' : undefined}>
      {m.sidebar.notes}
    </a>

    <h2 class="sidebar-heading">{m.sidebar.folders}</h2>

    <h2 class="sidebar-heading">{m.sidebar.labels}</h2>

    <a
      class="sidebar-link"
      href="/archive"
      use:link
      aria-current={route.name === 'archive' ? 'page' : undefined}
    >
      {m.sidebar.archive}
    </a>
    <a class="sidebar-link" href="/trash" use:link aria-current={route.name === 'trash' ? 'page' : undefined}>
      {m.sidebar.trash}
    </a>
    <a
      class="sidebar-link"
      href="/settings"
      use:link
      aria-current={route.name === 'settings' ? 'page' : undefined}
    >
      {m.sidebar.settings}
    </a>
  </nav>
{/if}
