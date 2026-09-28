<script lang="ts">
  import type { FolderTreeNode } from '../../shared/folder-tree'
  import type { Folder } from '../../shared/types'
  import {
    canCreateSubfolder,
    createFolder,
    disabledMoveTargets,
    folders,
    isFolderExpanded,
    moveFolder,
    removeFolder,
    renameFolder,
    toggleFolderExpanded,
  } from '../lib/folders.svelte'
  import { messages } from '../lib/i18n.svelte'
  import { currentRoute, navigate, link } from '../lib/router.svelte'
  import FolderPicker from './FolderPicker.svelte'
  import FolderTree from './FolderTree.svelte'

  const { nodes }: { nodes: FolderTreeNode<Folder>[] } = $props()

  const m = $derived(messages())
  const route = $derived(currentRoute())

  // Which node's "..." menu is open, and which node (if any) has its move
  // picker open. State is per recursive instance, so a menu opened at
  // another nesting level stays open too; acceptable for a small sidebar
  // menu, where at most one is likely to be open at a time in practice.
  let menuFor = $state<string | null>(null)
  let movingFolder = $state<Folder | null>(null)

  const moveDisabledIds = $derived(movingFolder ? disabledMoveTargets(movingFolder.id) : [])

  async function handleNewSubfolder(parentId: string): Promise<void> {
    const name = window.prompt(m.folders.namePrompt)
    if (!name || !name.trim()) return
    await createFolder(name.trim(), parentId)
  }

  function toggleMenu(id: string): void {
    menuFor = menuFor === id ? null : id
  }

  async function handleRename(folder: Folder): Promise<void> {
    menuFor = null
    const name = window.prompt(m.folders.renamePrompt, folder.name)
    if (!name || !name.trim() || name.trim() === folder.name) return
    await renameFolder(folder.id, name.trim())
  }

  function handleMoveClick(folder: Folder): void {
    menuFor = null
    movingFolder = folder
  }

  async function handleMovePick(parentId: string | null): Promise<void> {
    const folder = movingFolder
    movingFolder = null
    if (!folder || parentId === folder.parentId) return
    await moveFolder(folder.id, parentId)
  }

  async function handleDelete(folder: Folder): Promise<void> {
    menuFor = null
    if (!window.confirm(m.folders.deleteConfirm(folder.name))) return
    const ok = await removeFolder(folder.id)
    // Its notes and subfolders moved to the parent, so a route pointing at
    // the now-gone folder would 404; send the user up one level instead.
    if (ok && route.name === 'folder' && route.id === folder.id) {
      navigate(folder.parentId ? `/folder/${encodeURIComponent(folder.parentId)}` : '/')
    }
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
        <div class="folder-menu-wrap">
          <button
            type="button"
            class="folder-menu-trigger"
            aria-label={m.folders.actions}
            title={m.folders.actions}
            onclick={() => toggleMenu(node.folder.id)}
          >
            ⋯
          </button>
          {#if menuFor === node.folder.id}
            <div class="folder-menu" role="menu">
              <button type="button" role="menuitem" onclick={() => handleRename(node.folder)}>
                {m.folders.rename}
              </button>
              <button type="button" role="menuitem" onclick={() => handleMoveClick(node.folder)}>
                {m.folders.move}
              </button>
              <button type="button" role="menuitem" class="danger" onclick={() => handleDelete(node.folder)}>
                {m.folders.delete}
              </button>
            </div>
          {/if}
        </div>
      </div>
      {#if node.children.length > 0 && isFolderExpanded(node.folder.id)}
        <div class="folder-children">
          <FolderTree nodes={node.children} />
        </div>
      {/if}
    </li>
  {/each}
</ul>

{#if movingFolder}
  <FolderPicker
    title={m.folders.moveTitle}
    folders={folders()}
    disabledIds={moveDisabledIds}
    onpick={handleMovePick}
    oncancel={() => (movingFolder = null)}
  />
{/if}

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

  .folder-menu-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .folder-menu-trigger {
    background: none;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 6px;
  }

  .folder-menu {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 1;
    display: flex;
    flex-direction: column;
    min-width: 120px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px color-mix(in srgb, black 20%, transparent);
  }

  .folder-menu button {
    border: 0;
    background: none;
    text-align: left;
    padding: 6px 8px;
  }

  .folder-menu button:hover {
    background: var(--surface-muted);
    border-color: transparent;
  }

  .folder-menu button.danger {
    color: var(--danger);
  }

  .folder-children {
    padding-left: 16px;
  }
</style>
