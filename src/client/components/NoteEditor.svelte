<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import type { UpdateNoteInput } from '../../shared/types'
  import { ApiError, createNote, deleteNoteForever, fetchNote, restoreNote, trashNote, updateNote } from '../lib/api'
  import { createAutosave, type AutosaveStatus } from '../lib/autosave'
  import { describeApiError } from '../lib/errors'
  import { messages } from '../lib/i18n.svelte'
  import { openNote } from '../lib/router.svelte'

  // The parent unmounts this component when `?note` is removed, but never
  // remounts it in place: the only change to `id` this instance ever sees is
  // `new` turning into a real id, and this component drives that itself
  // (`noteId`, below). So reading the prop once here is deliberate.
  const { id, onclose, onsettled }: { id: string; onclose: () => void; onsettled: () => void } = $props()
  const initialId = untrack(() => id)

  const m = $derived(messages())

  let dialogEl: HTMLDialogElement | undefined
  let noteId = $state<string | null>(initialId === 'new' ? null : initialId)
  let title = $state('')
  let body = $state('')
  let pinned = $state(false)
  let archived = $state(false)
  let trashedAt = $state<number | null>(null)
  let loading = $state(initialId !== 'new')
  let loadError = $state<string | null>(null)
  let status = $state<AutosaveStatus>('idle')
  let saveError = $state<string | null>(null)

  const readOnly = $derived(trashedAt !== null)

  // False once this instance starts closing, so an autosave that resolves
  // after Back has already removed `?note` does not push a new history
  // entry to reopen it.
  let open = true

  // True while the first save is turning `note=new` into a real note. Kept
  // separate from `hasContent()` so an edit that arrives during that POST
  // (including clearing every field back to empty) still reaches autosave
  // instead of being silently dropped by the "nothing to create" guard.
  let creating = false

  // Set by the wrapper below right before a save that created or updated
  // nothing resolves, so the `onStatus` callback can skip announcing "Saved"
  // (or leave a stuck "Saving…") for a save that did not actually happen.
  let lastSaveWasNoop = false

  function hasContent(): boolean {
    return title.trim().length > 0 || body.trim().length > 0
  }

  /** Resolves to whether it actually created or updated anything. */
  async function performSave(patch: UpdateNoteInput): Promise<boolean> {
    if (!noteId) {
      if (!creating && !hasContent()) return false
      creating = true
      try {
        const created = await createNote({ title, body })
        noteId = created.id
        trashedAt = created.trashedAt
        if (open) openNote(created.id, { replace: true })
      } finally {
        creating = false
      }
      return true
    }
    const updated = await updateNote(noteId, patch)
    trashedAt = updated.trashedAt
    return true
  }

  const autosave = createAutosave<UpdateNoteInput>(
    async (patch) => {
      saveError = null
      lastSaveWasNoop = false
      try {
        lastSaveWasNoop = !(await performSave(patch))
      } catch (cause) {
        // A note trashed from another tab rejects further PATCHes; reflect
        // that here instead of letting every keystroke fail silently.
        if (cause instanceof ApiError && cause.code === 'note_trashed') trashedAt = Date.now()
        saveError = describeApiError(cause, m)
        throw cause
      }
    },
    800,
    (next) => {
      status = next === 'saved' && lastSaveWasNoop ? 'idle' : next
    },
  )

  onMount(() => {
    dialogEl?.showModal()
    if (initialId !== 'new') void load()
  })

  onDestroy(() => {
    open = false
    // The only teardown path that is not already covered by a guarded flush
    // elsewhere (Back navigation unmounts this component directly, without
    // going through `close()`/`handleDialogClose`), so this is also where
    // `onsettled` fires to tell the list it can safely reload.
    void (async () => {
      await autosave.flush()
      onsettled()
    })()
  })

  async function load(): Promise<void> {
    try {
      const note = await fetchNote(initialId)
      noteId = note.id
      title = note.title
      body = note.body
      pinned = note.pinned
      archived = note.archived
      trashedAt = note.trashedAt
    } catch (cause) {
      loadError = describeApiError(cause, m)
    } finally {
      loading = false
    }
  }

  function onTitleInput(): void {
    if (!noteId && !creating && !hasContent()) return
    autosave.update({ title })
  }

  function onBodyInput(): void {
    if (!noteId && !creating && !hasContent()) return
    autosave.update({ body })
  }

  async function togglePinned(): Promise<void> {
    if (!noteId) return
    try {
      const updated = await updateNote(noteId, { pinned: !pinned })
      pinned = updated.pinned
    } catch (cause) {
      saveError = describeApiError(cause, m)
    }
  }

  async function toggleArchived(): Promise<void> {
    if (!noteId) return
    try {
      const updated = await updateNote(noteId, { archived: !archived })
      archived = updated.archived
    } catch (cause) {
      saveError = describeApiError(cause, m)
    }
  }

  async function moveToTrash(): Promise<void> {
    if (!noteId) return
    try {
      // Flush first: trashing then letting a queued edit PATCH afterwards
      // would hit the 409 a trashed note returns and drop that edit. If the
      // flush itself failed, the edit is still only local; trashing now
      // would abandon it for good, so stop and show the error instead.
      const flushed = await autosave.flush()
      if (!flushed) return
      await trashNote(noteId)
      close()
    } catch (cause) {
      saveError = describeApiError(cause, m)
    }
  }

  async function restore(): Promise<void> {
    if (!noteId) return
    try {
      await restoreNote(noteId)
      close()
    } catch (cause) {
      saveError = describeApiError(cause, m)
    }
  }

  async function deleteForever(): Promise<void> {
    if (!noteId) return
    if (!confirm(m.editor.deleteForeverConfirm)) return
    try {
      await deleteNoteForever(noteId)
      close()
    } catch (cause) {
      saveError = describeApiError(cause, m)
    }
  }

  function close(): void {
    dialogEl?.close()
  }

  // Guards the Close button and Esc: flush before actually closing, and if
  // the flush failed, stay open and show the error rather than discarding
  // the edit silently.
  let closing = false

  async function requestClose(): Promise<void> {
    if (closing) return
    closing = true
    try {
      const flushed = await autosave.flush()
      if (flushed) close()
    } finally {
      closing = false
    }
  }

  function handleCancel(event: Event): void {
    // The default (Esc) would close immediately, before the flush; run the
    // same guarded path as the Close button instead.
    event.preventDefault()
    void requestClose()
  }

  /**
   * Fires whenever the dialog actually closes, including paths that bypass
   * `requestClose` (a second Esc can skip `cancel`'s `preventDefault` in some
   * browsers). The flush here is a fallback that is a no-op once
   * `requestClose` has already drained everything.
   */
  async function handleDialogClose(): Promise<void> {
    await autosave.flush()
    onclose()
  }
</script>

<dialog bind:this={dialogEl} class="note-editor" onclose={handleDialogClose} oncancel={handleCancel}>
  {#if loading}
    <p class="note-editor-status">{m.notes.loading}</p>
  {:else if loadError}
    <p class="note-editor-status error">{loadError}</p>
    <div class="note-editor-actions">
      <span class="note-editor-spacer"></span>
      <button type="button" onclick={requestClose}>{m.editor.close}</button>
    </div>
  {:else}
    <input
      class="note-editor-title"
      type="text"
      placeholder={m.editor.titlePlaceholder}
      bind:value={title}
      oninput={onTitleInput}
      readonly={readOnly}
    />
    <textarea
      class="note-editor-body"
      placeholder={m.editor.takeANote}
      bind:value={body}
      oninput={onBodyInput}
      readonly={readOnly}
    ></textarea>

    {#if saveError}
      <p class="note-editor-status error">{saveError}</p>
    {:else if readOnly}
      <p class="note-editor-status">{m.editor.readOnlyTrashed}</p>
    {:else if status === 'saving'}
      <p class="note-editor-status">{m.editor.saving}</p>
    {:else if status === 'saved'}
      <p class="note-editor-status">{m.editor.saved}</p>
    {/if}

    <div class="note-editor-actions">
      {#if readOnly}
        <button type="button" onclick={restore}>{m.editor.restore}</button>
        <button type="button" class="danger" onclick={deleteForever}>{m.editor.deleteForever}</button>
      {:else}
        <button type="button" disabled={!noteId} onclick={togglePinned}>
          {pinned ? m.editor.unpin : m.editor.pin}
        </button>
        <button type="button" disabled={!noteId} onclick={toggleArchived}>
          {archived ? m.editor.unarchive : m.editor.archive}
        </button>
        <button type="button" disabled={!noteId} onclick={moveToTrash}>{m.editor.trash}</button>
      {/if}
      <span class="note-editor-spacer"></span>
      <button type="button" onclick={requestClose}>{m.editor.close}</button>
    </div>
  {/if}
</dialog>

<style>
  .note-editor {
    width: min(680px, 92vw);
    max-height: 85vh;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .note-editor-title {
    font-weight: 600;
    border: 0;
    padding: 4px 2px;
  }

  .note-editor-body {
    flex: 1;
    min-height: 40vh;
    resize: vertical;
    border: 0;
    padding: 4px 2px;
  }

  .note-editor-title:focus-visible,
  .note-editor-body:focus-visible {
    outline: none;
  }

  .note-editor-status {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .note-editor-status.error {
    color: var(--danger);
  }

  .note-editor-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .note-editor-spacer {
    flex: 1;
  }

  .note-editor-actions .danger {
    color: var(--danger);
    border-color: var(--danger);
  }
</style>
