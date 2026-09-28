<script lang="ts">
  import FolderTree from './FolderTree.svelte'
  import { canCreateSubfolder, createFolder, folderError, folderTree, folders } from '../lib/folders.svelte'
  import { messages } from '../lib/i18n.svelte'
  import { currentRoute, link } from '../lib/router.svelte'
  import { sidebarOpen } from '../lib/sidebar.svelte'

  const m = $derived(messages())
  const route = $derived(currentRoute())
  const tree = $derived(folderTree())

  async function handleNewFolder(): Promise<void> {
    const name = window.prompt(m.folders.namePrompt)
    if (!name || !name.trim()) return
    await createFolder(name.trim(), null)
  }
</script>

{#if sidebarOpen()}
  <nav class="sidebar">
    <a class="sidebar-link" href="/" use:link aria-current={route.name === 'notes' ? 'page' : undefined}>
      {m.sidebar.notes}
    </a>

    <div class="sidebar-heading-row">
      <h2 class="sidebar-heading">{m.sidebar.folders}</h2>
      <button
        type="button"
        class="sidebar-heading-action"
        aria-label={m.folders.newFolder}
        title={m.folders.newFolder}
        disabled={!canCreateSubfolder(null)}
        onclick={handleNewFolder}
      >
        +
      </button>
    </div>
    {#if folderError()}
      <p class="sidebar-error">{folderError()}</p>
    {/if}
    {#if folders().length === 0}
      <p class="sidebar-empty">{m.folders.empty}</p>
    {:else}
      <FolderTree nodes={tree} />
    {/if}

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
