<script lang="ts">
  import { untrack } from 'svelte'
  import type { NoteSummary, UpdateNoteInput } from '../../shared/types'
  import FolderPicker from '../components/FolderPicker.svelte'
  import NoteEditor from '../components/NoteEditor.svelte'
  import NoteGrid from '../components/NoteGrid.svelte'
  import { emptyTrash as emptyTrashRequest, listNotes, updateNote } from '../lib/api'
  import { describeApiError } from '../lib/errors'
  import { folderById, folders } from '../lib/folders.svelte'
  import { messages } from '../lib/i18n.svelte'
  import { reloadLabels } from '../lib/labels.svelte'
  import { notesVersion } from '../lib/note-moves.svelte'
  import { closeNote, currentRoute, openNote } from '../lib/router.svelte'
  import { noteParam, type ListQuery } from '../lib/routes'

  let { query }: { query: ListQuery } = $props()

  const m = $derived(messages())

  // `routes.ts` has no notion of the `note` query param; re-reading location
  // whenever the router touches history (including note-only changes, which
  // reassign `state.current` without changing the parsed route) keeps this in
  // step without needing a reactive export from router.svelte.ts.
  const noteId = $derived.by(() => {
    currentRoute()
    return noteParam(window.location.search)
  })

  let items = $state<NoteSummary[]>([])
  let nextCursor = $state<string | null>(null)
  let loading = $state(false)
  let loadingMore = $state(false)
  // Set for every load, including quiet ones; a page fetched with the old
  // cursor must not be appended to a first page that is about to be replaced.
  let reloading = $state(false)
  let error = $state<string | null>(null)
  let movingNote = $state<NoteSummary | null>(null)

  // `query` is a fresh object on every render (it is derived from route state
  // that `openNote` also touches), so keying the reload effect on a primitive
  // avoids refetching just because the note-editor dialog opened or closed.
  const queryKey = $derived(`${query.view}|${query.folder ?? ''}|${query.label ?? ''}|${query.q ?? ''}`)

  // Discards a response that arrives after a newer load has started.
  let generation = 0

  // `quiet` keeps the current grid on screen instead of flashing the loading
  // state, for reloads triggered by an in-place action.
  async function load(options: { quiet?: boolean } = {}): Promise<void> {
    const gen = ++generation
    const { view, folder, label, q } = query
    if (!options.quiet) loading = true
    reloading = true
    error = null
    try {
      const response = await listNotes({ view, folder, label, q })
      if (gen !== generation) return
      items = response.items
      nextCursor = response.nextCursor
    } catch (e) {
      if (gen !== generation) return
      error = describeApiError(e, m)
    } finally {
      if (gen === generation) {
        loading = false
        reloading = false
      }
    }
  }

  $effect(() => {
    queryKey
    // `load` also reads `query` fields; wrapping the call keeps those reads
    // untracked too, so only `queryKey` changing reruns this effect.
    untrack(() => void load())
  })

  // Reload when a note is moved from the sidebar. The first run is skipped so
  // mounting does not issue a second list request.
  let seenNotesVersion = untrack(notesVersion)
  $effect(() => {
    const version = notesVersion()
    if (version === seenNotesVersion) return
    seenNotesVersion = version
    untrack(() => void load({ quiet: true }))
  })

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore || reloading) return
    const gen = generation
    const { view, folder, label, q } = query
    loadingMore = true
    try {
      const response = await listNotes({ view, folder, label, q, cursor: nextCursor })
      if (gen !== generation) return
      items = [...items, ...response.items]
      nextCursor = response.nextCursor
    } catch (e) {
      if (gen !== generation) return
      error = describeApiError(e, m)
    } finally {
      // Always cleared, unlike `loading`: a stale `loadMore` in flight after
      // a view switch must not leave the button disabled for the new view.
      loadingMore = false
    }
  }

  async function updateFromCard(id: string, patch: Pick<UpdateNoteInput, 'pinned' | 'archived' | 'locked' | 'folderId'>): Promise<void> {
    const gen = generation
    try {
      await updateNote(id, patch)
    } catch (e) {
      if (gen !== generation) return
      error = describeApiError(e, m)
      return
    }
    await load({ quiet: true })
  }

  function handleMovePick(folderId: string | null): void {
    const note = movingNote
    movingNote = null
    if (!note || folderId === note.folderId) return
    void updateFromCard(note.id, { folderId })
  }

  async function handleEmptyTrash(): Promise<void> {
    if (!confirm(m.notes.emptyTrashConfirm)) return
    const gen = generation
    try {
      await emptyTrashRequest()
      if (gen !== generation) return
      items = []
      nextCursor = null
      void reloadLabels()
    } catch (e) {
      if (gen !== generation) return
      error = describeApiError(e, m)
    }
  }

  const currentFolder = $derived(query.folder ? folderById(query.folder) : undefined)

  const pinned = $derived(query.view === 'notes' ? items.filter((n) => n.pinned) : [])
  const others = $derived(query.view === 'notes' ? items.filter((n) => !n.pinned) : items)

  function emptyMessage(): string {
    switch (query.view) {
      case 'archive':
        return m.notes.emptyArchive
      case 'trash':
        return m.notes.emptyTrash
      case 'all':
        return m.notes.emptySearch
      default:
        return m.notes.emptyNotes
    }
  }
</script>

<div class="notes-view">
  {#if currentFolder}
    <h1 class="notes-view-title">{currentFolder.name}</h1>
  {:else if query.view === 'all'}
    <h1 class="notes-view-title">{m.search.resultsFor(query.q ?? '')}</h1>
  {/if}

  {#if query.view === 'notes'}
    <button type="button" class="take-a-note" onclick={() => openNote('new')}>{m.editor.takeANote}</button>
  {/if}

  {#if query.view === 'trash' && items.length > 0}
    <div class="notes-toolbar">
      <button type="button" onclick={handleEmptyTrash}>{m.notes.emptyTrashAction}</button>
    </div>
  {/if}

  {#if error}
    <p class="notes-error">{error}</p>
  {/if}

  {#if loading}
    <p class="notes-status">{m.notes.loading}</p>
  {:else if items.length === 0}
    <p class="notes-status">{emptyMessage()}</p>
  {:else if query.view === 'notes'}
    {#if pinned.length > 0}
      <h2 class="notes-heading">{m.notes.pinned}</h2>
      <NoteGrid notes={pinned} onopen={openNote} onupdate={updateFromCard} onmove={(note) => (movingNote = note)} />
      {#if others.length > 0}
        <h2 class="notes-heading">{m.notes.others}</h2>
      {/if}
    {/if}
    <NoteGrid notes={others} onopen={openNote} onupdate={updateFromCard} onmove={(note) => (movingNote = note)} />
  {:else}
    <NoteGrid notes={others} onopen={openNote} onupdate={updateFromCard} onmove={(note) => (movingNote = note)} />
  {/if}

  {#if movingNote}
    <FolderPicker
      title={m.editor.moveTo}
      folders={folders()}
      disabledIds={movingNote.folderId ? [movingNote.folderId] : []}
      onpick={handleMovePick}
      oncancel={() => (movingNote = null)}
    />
  {/if}

  {#if nextCursor}
    <div class="notes-load-more">
      <button type="button" disabled={loadingMore || reloading} onclick={loadMore}>{m.notes.loadMore}</button>
    </div>
  {/if}
</div>

{#if noteId}
  <NoteEditor
    id={noteId}
    folderId={query.folder ?? null}
    label={query.label ?? null}
    onclose={closeNote}
    onsettled={() => load()}
  />
{/if}

<style>
  .notes-view {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .notes-view-title {
    margin: 0;
  }

  .notes-heading {
    margin: 8px 0 0;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .notes-status {
    color: var(--text-muted);
  }

  .notes-error {
    color: var(--danger);
  }

  .notes-toolbar,
  .notes-load-more {
    display: flex;
    justify-content: flex-end;
  }

  .take-a-note {
    align-self: flex-start;
    width: min(600px, 100%);
    justify-content: flex-start;
    padding: 10px 16px;
    color: var(--text-muted);
  }

  @media (max-width: 720px) {
    .notes-view {
      padding: 12px;
    }
  }
</style>
