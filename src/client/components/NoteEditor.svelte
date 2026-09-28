<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { effectiveFormat } from '../../shared/format'
  import { normalizeLabels, parseLabelInput } from '../../shared/labels'
  import { LABEL_MAX_CHARS, LABELS_PER_NOTE_MAX } from '../../shared/limits'
  import type { ConcreteFormat, NoteFormat, UpdateNoteInput } from '../../shared/types'
  import { ApiError, createNote, deleteNoteForever, fetchNote, restoreNote, trashNote, updateNote } from '../lib/api'
  import { createAutosave, type AutosaveStatus } from '../lib/autosave'
  import { describeApiError } from '../lib/errors'
  import { folderById, folders } from '../lib/folders.svelte'
  import { messages } from '../lib/i18n.svelte'
  import { reloadLabels, sameLabelSet } from '../lib/labels.svelte'
  import { openNote } from '../lib/router.svelte'
  import { settings } from '../lib/settings.svelte'
  import FolderPicker from './FolderPicker.svelte'
  import MarkdownView from './MarkdownView.svelte'

  // The parent unmounts this component when `?note` is removed, but never
  // remounts it in place: the only change to `id` this instance ever sees is
  // `new` turning into a real id, and this component drives that itself
  // (`noteId`, below). So reading the prop once here is deliberate.
  const {
    id,
    folderId = null,
    onclose,
    onsettled,
  }: { id: string; folderId?: string | null; onclose: () => void; onsettled: () => void } = $props()
  const initialId = untrack(() => id)
  // Only relevant to a brand-new note: once created, the note keeps its own folder.
  const initialFolderId = untrack(() => folderId)

  const m = $derived(messages())

  let dialogEl: HTMLDialogElement | undefined
  let noteId = $state<string | null>(initialId === 'new' ? null : initialId)
  let title = $state('')
  let body = $state('')
  let format = $state<NoteFormat>('inherit')
  let currentFolderId = $state<string | null>(initialFolderId)
  let pickingFolder = $state(false)
  let labelsText = $state('')
  // The last set confirmed by the server, used to decide whether an edit to
  // `labelsText` is worth a PATCH: `labels` bumps `updated_at` unconditionally
  // server-side, so re-sending the same set on every keystroke would too.
  let savedLabels = $state<string[]>([])
  let labelsError = $state<string | null>(null)
  let pinned = $state(false)
  let archived = $state(false)
  let trashedAt = $state<number | null>(null)
  let loading = $state(initialId !== 'new')
  let loadError = $state<string | null>(null)
  let status = $state<AutosaveStatus>('idle')
  let saveError = $state<string | null>(null)

  const readOnly = $derived(trashedAt !== null)
  const effective = $derived(effectiveFormat(format, settings()))

  // A brand-new note opens straight into the textarea so "Take a note…"
  // does not need an extra click; an existing formatted note opens into the
  // rendered view, with Edit available to reach the textarea.
  let editingBody = $state(initialId === 'new')
  const showTextarea = $derived(effective === 'syntax' || editingBody)

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
        // Labels typed before the note had a title or body never reached the
        // autosave queue, so the create reads the current input instead.
        const initialLabels = normalizeLabels(parseLabelInput(labelsText))
        const created = await createNote({
          title,
          body,
          folderId: initialFolderId,
          ...(initialLabels.ok && initialLabels.labels.length > 0 ? { labels: initialLabels.labels } : {}),
        })
        noteId = created.id
        format = created.format
        trashedAt = created.trashedAt
        currentFolderId = created.folderId
        savedLabels = created.labels
        if (open) openNote(created.id, { replace: true })
      } finally {
        creating = false
      }
      return true
    }
    const updated = await updateNote(noteId, patch)
    format = updated.format
    trashedAt = updated.trashedAt
    savedLabels = updated.labels
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
      // Covers every path that changes label counts while this note was
      // open: an edited label, a trash/restore, or a permanent delete.
      void reloadLabels()
    })()
  })

  async function load(): Promise<void> {
    try {
      const note = await fetchNote(initialId)
      noteId = note.id
      title = note.title
      body = note.body
      format = note.format
      pinned = note.pinned
      archived = note.archived
      trashedAt = note.trashedAt
      currentFolderId = note.folderId
      savedLabels = note.labels
      labelsText = note.labels.join(', ')
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

  function onLabelsInput(): void {
    labelsError = null
    if (!noteId && !creating && !hasContent()) return

    const result = normalizeLabels(parseLabelInput(labelsText))
    if (!result.ok) {
      // Commas are split out by parseLabelInput, so only length and count can fail here.
      labelsError =
        result.reason === 'too_long' ? m.editor.labelTooLong(LABEL_MAX_CHARS) : m.editor.tooManyLabels(LABELS_PER_NOTE_MAX)
      return
    }
    if (sameLabelSet(result.labels, savedLabels)) return
    autosave.update({ labels: result.labels })
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

  // Always sent as its own single-field PATCH, never merged into the
  // debounced title/body autosave: a format change is a discrete, immediate
  // action. Flushing first avoids a race where a body PATCH already in
  // flight resolves after this one and overwrites `format` with the stale
  // value it read before this PATCH committed, which would make the toggle
  // show "(default)" for a note the server already locked to a concrete
  // format.
  async function toggleFormat(): Promise<void> {
    if (!noteId) return
    const flushed = await autosave.flush()
    if (!flushed) return
    const next: ConcreteFormat = effective === 'formatted' ? 'syntax' : 'formatted'
    try {
      const updated = await updateNote(noteId, { format: next })
      format = updated.format
      editingBody = false
    } catch (cause) {
      saveError = describeApiError(cause, m)
    }
  }

  // Sent as its own single-field PATCH, flushing pending autosave first for
  // the same reason `toggleFormat` does: a body PATCH still in flight could
  // otherwise resolve after this one and overwrite `folderId` with the value
  // it read before the move committed.
  async function moveNote(target: string | null): Promise<void> {
    pickingFolder = false
    if (!noteId || target === currentFolderId) return
    const flushed = await autosave.flush()
    if (!flushed) return
    try {
      const updated = await updateNote(noteId, { folderId: target })
      currentFolderId = updated.folderId
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
    <input
      class="note-editor-labels"
      type="text"
      placeholder={m.editor.labelsPlaceholder}
      bind:value={labelsText}
      oninput={onLabelsInput}
      readonly={readOnly}
    />
    {#if labelsError}
      <p class="note-editor-status error">{labelsError}</p>
    {/if}
    {#if !readOnly}
      <div class="note-editor-toolbar">
        <button type="button" disabled={!noteId} onclick={toggleFormat}>
          {format === 'inherit'
            ? m.editor.formatDefault(effective === 'formatted' ? m.editor.formatFormatted : m.editor.formatSyntax)
            : effective === 'formatted'
              ? m.editor.formatFormatted
              : m.editor.formatSyntax}
        </button>
        {#if effective === 'formatted'}
          <button type="button" onclick={() => (editingBody = !editingBody)}>
            {editingBody ? m.editor.done : m.editor.edit}
          </button>
        {/if}
      </div>
    {/if}

    {#if showTextarea}
      <textarea
        class="note-editor-body"
        class:mono={effective === 'syntax'}
        placeholder={m.editor.takeANote}
        bind:value={body}
        oninput={onBodyInput}
        readonly={readOnly}
      ></textarea>
    {:else}
      <div class="note-editor-body note-editor-preview">
        <MarkdownView source={body} />
      </div>
    {/if}

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
        <button
          type="button"
          disabled={!noteId}
          title={currentFolderId ? folderById(currentFolderId)?.name : m.folders.noFolder}
          onclick={() => (pickingFolder = true)}
        >
          {m.editor.moveTo}
        </button>
        <button type="button" disabled={!noteId} onclick={moveToTrash}>{m.editor.trash}</button>
      {/if}
      <span class="note-editor-spacer"></span>
      <button type="button" onclick={requestClose}>{m.editor.close}</button>
    </div>
  {/if}
</dialog>

{#if pickingFolder}
  <FolderPicker
    title={m.editor.moveTo}
    folders={folders()}
    onpick={moveNote}
    oncancel={() => (pickingFolder = false)}
  />
{/if}

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

  .note-editor-labels {
    border: 0;
    padding: 4px 2px;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .note-editor-body {
    flex: 1;
    min-height: 40vh;
    resize: vertical;
    border: 0;
    padding: 4px 2px;
  }

  .note-editor-body.mono {
    font-family: var(--mono);
  }

  .note-editor-preview {
    overflow-y: auto;
    padding: 0;
  }

  .note-editor-toolbar {
    display: flex;
    gap: 8px;
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
