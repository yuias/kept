<script lang="ts">
  import type { FolderTreeNode } from '../../shared/folder-tree'
  import type { Folder } from '../../shared/types'
  import { canCreateSubfolder, createFolder, isFolderExpanded, toggleFolderExpanded } from '../lib/folders.svelte'
  import { messages } from '../lib/i18n.svelte'
  import { currentRoute, link } from '../lib/router.svelte'
  import FolderTree from './FolderTree.svelte'

  const { nodes }: { nodes: FolderTreeNode<Folder>[] } = $props()

  const m = $derived(messages())
  const route = $derived(currentRoute())

  async function handleNewSubfolder(parentId: string): Promise<void> {
    const name = window.prompt(m.folders.namePrompt)
    if (!name || !name.trim()) return
    await createFolder(name.trim(), parentId)
  }
</script>

<ul class="folder-tree">
  {#each nodes as node (node.folder.id)}
    <li>
      <div class="folder-row">
        {#if node.children.length > 0}
          <button
            type="button"
            class="folder-toggle"
            aria-label={isFolderExpanded(node.folder.id) ? m.folders.collapse : m.folders.expand}
            onclick={() => toggleFolderExpanded(node.folder.id)}
          >
            {isFolderExpanded(node.folder.id) ? '▾' : '▸'}
          </button>
        {:else}
          <span class="folder-toggle-spacer"></span>
        {/if}
        <a
          class="sidebar-link folder-link"
          href={`/folder/${encodeURIComponent(node.folder.id)}`}
          use:link
          aria-current={route.name === 'folder' && route.id === node.folder.id ? 'page' : undefined}
        >
          {node.folder.name}
        </a>
        <button
          type="button"
          class="folder-add"
          aria-label={m.folders.newSubfolder}
          title={m.folders.newSubfolder}
          disabled={!canCreateSubfolder(node.folder.id)}
          onclick={() => handleNewSubfolder(node.folder.id)}
        >
          +
        </button>
      </div>
      {#if node.children.length > 0 && isFolderExpanded(node.folder.id)}
        <div class="folder-children">
          <FolderTree nodes={node.children} />
        </div>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .folder-tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .folder-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .folder-link {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-toggle,
  .folder-toggle-spacer {
    width: 18px;
    flex-shrink: 0;
    text-align: center;
  }

  .folder-toggle {
    background: none;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
  }

  .folder-add {
    flex-shrink: 0;
    background: none;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 6px;
  }

  .folder-add:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .folder-children {
    padding-left: 16px;
  }
</style>
