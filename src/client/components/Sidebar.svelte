<script lang="ts">
  import { asciiLower } from '../../shared/labels'
  import FolderTree from './FolderTree.svelte'
  import { canCreateSubfolder, createFolder, folderError, folderTree, folders } from '../lib/folders.svelte'
  import { messages } from '../lib/i18n.svelte'
  import { isLabelsExpanded, labelCounts, labelError, toggleLabelsExpanded } from '../lib/labels.svelte'
  import { currentRoute, link } from '../lib/router.svelte'
  import { sidebarOpen } from '../lib/sidebar.svelte'

  const m = $derived(messages())
  const route = $derived(currentRoute())
  const tree = $derived(folderTree())

  /** ASCII-only fold, matching how the server compares label names (SQLite `COLLATE NOCASE`). */
  function isCurrentLabel(name: string): boolean {
    return route.name === 'label' && asciiLower(route.label) === asciiLower(name)
  }

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

    <div class="sidebar-heading-row">
      <button
        type="button"
        class="sidebar-heading-toggle"
        aria-expanded={isLabelsExpanded()}
        aria-label={isLabelsExpanded() ? m.labels.collapse : m.labels.expand}
        onclick={toggleLabelsExpanded}
      >
        <span class="folder-toggle-icon">{isLabelsExpanded() ? '▾' : '▸'}</span>
        <h2 class="sidebar-heading">{m.sidebar.labels}</h2>
      </button>
    </div>
    {#if isLabelsExpanded()}
      {#if labelError()}
        <p class="sidebar-error">{labelError()}</p>
      {:else if labelCounts().length === 0}
        <p class="sidebar-empty">{m.labels.empty}</p>
      {:else}
        <ul class="label-list">
          {#each labelCounts() as label (label.name)}
            <li>
              <a
                class="sidebar-link label-link"
                href={`/label/${encodeURIComponent(label.name)}`}
                use:link
                aria-current={isCurrentLabel(label.name) ? 'page' : undefined}
              >
                <span class="label-name">{label.name}</span>
                <span class="label-count">{label.count}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

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
