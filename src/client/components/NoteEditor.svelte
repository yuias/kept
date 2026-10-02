<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte'
  import { effectiveFormat } from '../../shared/format'
  import { normalizeLabels, parseLabelInput } from '../../shared/labels'
  import { LABEL_MAX_CHARS, LABELS_PER_NOTE_MAX } from '../../shared/limits'
  import { copyableNoteText } from '../../shared/note-text'
  import type { ConcreteFormat, ImageUploadResponse, NoteFormat, UpdateNoteInput } from '../../shared/types'
  import { ApiError, createNote, deleteNoteForever, fetchNote, restoreNote, trashNote, updateNote } from '../lib/api'
  import { createAutosave, type AutosaveStatus } from '../lib/autosave'
  import { createCopyAction } from '../lib/clipboard.svelte'
  import { formatEdited, formatFullTimestamp } from '../lib/datetime'
  import { isOutsideRect } from '../lib/dialog'
  import { describeApiError } from '../lib/errors'
  import { formatToCommit, nextFormat, showsDefault } from '../lib/format-toggle'
  import { folderById, folders } from '../lib/folders.svelte'
  import { locale, messages } from '../lib/i18n.svelte'
  import { insertAt, makePlaceholder, replacePlaceholder } from '../lib/image/insert'
  import { encodeToWebp, importFromUrl, uploadWebp } from '../lib/image/pipeline'
  import { reloadLabels, sameLabelSet } from '../lib/labels.svelte'
  import { openNote } from '../lib/router.svelte'
  import { settings } from '../lib/settings.svelte'
  import FolderPicker from './FolderPicker.svelte'
  import Icon from './Icon.svelte'
  import ImageUrlDialog from './ImageUrlDialog.svelte'
  import type LiveEditor from './LiveEditor.svelte'

  // The parent unmounts this component when `?note` is removed, but never
  // remounts it in place: the only change to `id` this instance ever sees is
  // `new` turning into a real id, and this component drives that itself
  // (`noteId`, below). So reading the prop once here is deliberate.
  const {
    id,
    folderId = null,
    label = null,
    onclose,
    onsettled,
  }: {
    id: string
    folderId?: string | null
    label?: string | null
    onclose: () => void
    onsettled: () => void
  } = $props()
  const initialId = untrack(() => id)
  // Only relevant to a brand-new note: once created, the note keeps its own folder.
  const initialFolderId = untrack(() => folderId)
  // Same for the label being viewed: a new note starts with it filled in.
  const initialLabel = untrack(() => (initialId === 'new' ? label : null))

  const m = $derived(messages())

  let dialogEl: HTMLDialogElement | undefined
  let noteId = $state<string | null>(initialId === 'new' ? null : initialId)
  let title = $state('')
  let body = $state('')
  let format = $state<NoteFormat>('inherit')
  // The toggle only changes this; the PATCH is sent when the editor closes so
  // that flipping back and forth never touches the server (or the note's order).
  let pendingFormat = $state<ConcreteFormat | null>(null)
  let currentFolderId = $state<string | null>(initialFolderId)
  const currentFolderName = $derived(
    currentFolderId ? (folderById(currentFolderId)?.name ?? m.folders.noFolder) : m.folders.noFolder,
  )
  let pickingFolder = $state(false)
  let labelsText = $state(initialLabel ?? '')
  // The last set confirmed by the server, used to decide whether an edit to
  // `labelsText` is worth a PATCH: `labels` bumps `updated_at` unconditionally
  // server-side, so re-sending the same set on every keystroke would too.
  let savedLabels = $state<string[]>([])
  let labelsError = $state<string | null>(null)
  let pinned = $state(false)
  let archived = $state(false)
  let trashedAt = $state<number | null>(null)
  let updatedAt = $state<number | null>(null)
  let loading = $state(initialId !== 'new')
  let loadError = $state<string | null>(null)
  let status = $state<AutosaveStatus>('idle')
  let saveError = $state<string | null>(null)

  let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined)
  // CodeMirror is heavy, so the live editor is fetched only when a note is
  // actually shown in formatted mode.
  let LiveEditorComponent = $state<typeof LiveEditor | null>(null)
  let liveEl = $state<ReturnType<typeof LiveEditor> | undefined>(undefined)
  let urlDialogOpen = $state(false)

  interface ImageTask {
    token: string
    status: 'uploading' | 'error'
    error?: string
  }
  let imageTasks = $state<ImageTask[]>([])
  // Tracks every in-flight placeholder replacement so the close paths can
  // wait for them: otherwise a flush could save the body with a placeholder
  // still in it, and the eventual replacement would land on an unmounted
  // component with nowhere left to persist it.
  const inflightImages = new Set<Promise<void>>()

  const readOnly = $derived(trashedAt !== null)
  const effective = $derived(pendingFormat ?? effectiveFormat(format, settings()))

  const formatLabel = $derived(effective === 'formatted' ? m.editor.formatFormatted : m.editor.formatSyntax)

  // A failed chunk load (offline, stale deploy) falls back to the plain
  // textarea so the note stays editable.
  let liveLoadFailed = $state(false)
  const showTextarea = $derived(effective === 'syntax' || liveLoadFailed)

  $effect(() => {
    if (effective !== 'formatted' || LiveEditorComponent || liveLoadFailed) return
    import('./LiveEditor.svelte').then(
      (mod) => {
        LiveEditorComponent = mod.default
      },
      () => {
        liveLoadFailed = true
      },
    )
  })

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
        updatedAt = created.updatedAt
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
    updatedAt = updated.updatedAt
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

  // A backdrop click only counts if the press also started on the backdrop, so
  // a text-selection drag that begins inside the dialog and ends outside does
  // not close it.
  let pointerDownOnBackdrop = false

  function isBackdropEvent(event: MouseEvent): boolean {
    const el = dialogEl
    if (!el) return false
    // With showModal(), a click on the dialog's own padding also has
    // target === dialogEl, so only a point outside its box is the backdrop.
    return event.target === el && isOutsideRect(el.getBoundingClientRect(), event.clientX, event.clientY)
  }

  function handleDialogPointerDown(event: PointerEvent): void {
    pointerDownOnBackdrop = event.button === 0 && isBackdropEvent(event)
  }

  function handleDialogClick(event: MouseEvent): void {
    const started = pointerDownOnBackdrop
    pointerDownOnBackdrop = false
    if (!started || pickingFolder || urlDialogOpen) return
    if (isBackdropEvent(event)) void requestClose()
  }

  onMount(() => {
    const el = dialogEl
    el?.showModal()
    // Listeners are attached here rather than in markup to avoid a11y warnings
    // for click handlers on <dialog>; Esc already covers keyboard users.
    el?.addEventListener('pointerdown', handleDialogPointerDown)
    el?.addEventListener('click', handleDialogClick)
    if (initialId !== 'new') void load()
    return () => {
      el?.removeEventListener('pointerdown', handleDialogPointerDown)
      el?.removeEventListener('click', handleDialogClick)
    }
  })

  onDestroy(() => {
    open = false
    copyAction.dispose()
    // Every close ends here: Back navigation unmounts this component
    // directly, and `handleDialogClose` clears the route without flushing.
    // So this is also where `onsettled` fires to tell the list it can safely
    // reload.
    void (async () => {
      await Promise.allSettled([...inflightImages])
      await autosave.flush()
      await commitFormat()
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
      updatedAt = note.updatedAt
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

  function addImageTask(token: string): void {
    imageTasks = [...imageTasks, { token, status: 'uploading' }]
  }

  function failImageTask(token: string, error: string): void {
    imageTasks = imageTasks.map((task) => (task.token === token ? { ...task, status: 'error', error } : task))
  }

  function resolveImageTask(token: string): void {
    imageTasks = imageTasks.filter((task) => task.token !== token)
  }

  function dismissImageTask(token: string): void {
    imageTasks = imageTasks.filter((task) => task.token !== token)
  }

  /**
   * Applies `newText` to `body` and, when the textarea is mounted, restores
   * the caret relative to `changeAt`: positions at or after it shift by
   * `delta` (the length change the edit introduced), positions before it do
   * not move. This holds for both an insertion at the caret (which then
   * lands right after the inserted text) and a later placeholder
   * replacement/removal (which only moves a caret that was inside or past
   * the placeholder).
   */
  async function mutateBody(newText: string, changeAt: number, delta: number): Promise<void> {
    const el = textareaEl
    const prevStart = el?.selectionStart ?? null
    const prevEnd = el?.selectionEnd ?? null
    body = newText
    onBodyInput()
    if (!el || prevStart === null || prevEnd === null) return
    await tick()
    const shift = (pos: number): number => (pos >= changeAt ? Math.max(changeAt, pos + delta) : pos)
    el.setSelectionRange(shift(prevStart), shift(prevEnd))
  }

  /** Runs `work`, then replaces `token` with the resulting markdown or removes it on failure. */
  async function runImageTask(token: string, work: () => Promise<ImageUploadResponse>): Promise<void> {
    const task = (async () => {
      try {
        const result = await work()
        const markdown = `![](${result.url})`
        if (!liveEl?.replaceText(token, markdown)) {
          const at = body.indexOf(token)
          if (at !== -1) await mutateBody(replacePlaceholder(body, token, markdown), at, markdown.length - token.length)
        }
        resolveImageTask(token)
      } catch (cause) {
        if (!liveEl?.replaceText(token, '')) {
          const at = body.indexOf(token)
          if (at !== -1) await mutateBody(replacePlaceholder(body, token, ''), at, -token.length)
        }
        failImageTask(token, describeApiError(cause, m))
      }
    })()
    inflightImages.add(task)
    try {
      await task
    } finally {
      inflightImages.delete(task)
    }
  }

  async function encodeAndUploadFile(file: File): Promise<ImageUploadResponse> {
    const result = await encodeToWebp(file)
    return uploadWebp(result)
  }

  async function insertImagePlaceholder(pos: number): Promise<string> {
    const token = makePlaceholder()
    if (liveEl) {
      liveEl.insertText(token)
      addImageTask(token)
      return token
    }
    await mutateBody(insertAt(body, pos, token), pos, token.length)
    addImageTask(token)
    return token
  }

  async function handlePaste(event: ClipboardEvent): Promise<void> {
    if (readOnly) return
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()

    for (const file of files) {
      const pos = textareaEl?.selectionStart ?? body.length
      const token = await insertImagePlaceholder(pos)
      void runImageTask(token, () => encodeAndUploadFile(file))
    }
  }

  function openImageUrlDialog(): void {
    if (readOnly) return
    urlDialogOpen = true
  }

  async function handleImageUrlInsert(url: string): Promise<void> {
    urlDialogOpen = false
    const pos = textareaEl?.selectionEnd ?? body.length
    const token = await insertImagePlaceholder(pos)
    void runImageTask(token, () => importFromUrl(url))
  }

  async function togglePinned(): Promise<void> {
    if (!noteId) return
    try {
      const updated = await updateNote(noteId, { pinned: !pinned })
      pinned = updated.pinned
      updatedAt = updated.updatedAt
    } catch (cause) {
      saveError = describeApiError(cause, m)
    }
  }

  // Local only: the format is committed by `commitFormat` when the editor
  // closes, always after `autosave.flush()`, so a body PATCH can never
  // overwrite it. The UI reads `pendingFormat` first, so it switches at once.
  function toggleFormat(): void {
    pendingFormat = nextFormat(effective)
  }

  let formatCommit: Promise<boolean> | null = null

  /** Resolves true when nothing is left to commit (committed, or nothing to do). */
  async function commitFormat(): Promise<boolean> {
    if (formatCommit) return formatCommit
    // A trashed note rejects PATCH; skip the request that is known to 409.
    if (trashedAt !== null) return true
    const id = noteId
    const target = id ? formatToCommit(format, pendingFormat, settings().defaultFormat) : null
    if (!id || target === null) return true
    formatCommit = (async () => {
      try {
        const updated = await updateNote(id, { format: target })
        format = updated.format
        updatedAt = updated.updatedAt
        pendingFormat = null
        return true
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 'note_trashed') {
          // Trashed elsewhere: the note is read-only now, so drop the change and let it close.
          trashedAt = Date.now()
          pendingFormat = null
          return true
        }
        saveError = describeApiError(cause, m)
        return false
      }
    })()
    try {
      return await formatCommit
    } finally {
      formatCommit = null
    }
  }

  // Sent as its own single-field PATCH, flushing pending autosave first: a
  // body PATCH still in flight could otherwise resolve after this one and
  // overwrite `folderId` with the value it read before the move committed.
  async function moveNote(target: string | null): Promise<void> {
    pickingFolder = false
    if (!noteId || target === currentFolderId) return
    const flushed = await autosave.flush()
    if (!flushed) return
    try {
      const updated = await updateNote(noteId, { folderId: target })
      currentFolderId = updated.folderId
      updatedAt = updated.updatedAt
    } catch (cause) {
      saveError = describeApiError(cause, m)
    }
  }

  async function toggleArchived(): Promise<void> {
    if (!noteId) return
    try {
      const updated = await updateNote(noteId, { archived: !archived })
      archived = updated.archived
      updatedAt = updated.updatedAt
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
      // Committed before trashing: after the trash, the PATCH would hit a 409.
      if (!(await commitFormat())) return
      await trashNote(noteId)
      close()
    } catch (cause) {
      saveError = describeApiError(cause, m)
    }
  }

  // Flushed first so "View raw"/"Download .md" never race a pending edit:
  // opening the export before an in-flight autosave lands could show stale
  // content in the new tab.
  // The tab is opened before awaiting the flush: popup blockers only allow
  // window.open during the click's transient activation.
  async function openRaw(query: string): Promise<void> {
    if (!noteId) return
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    const flushed = await autosave.flush()
    if (!flushed) {
      tab?.close()
      return
    }
    const url = `/raw/${noteId}${query}`
    if (tab) tab.location.href = url
    else window.open(url, '_blank', 'noopener')
  }

  // Copied from the editor state, so pending autosaves do not matter.
  const copyAction = createCopyAction()
  const copyLabel = $derived(
    copyAction.state === 'copied' ? m.editor.copied : copyAction.state === 'failed' ? m.editor.copyFailed : m.editor.copyText,
  )

  function copyNote(): Promise<void> {
    return copyAction.run(copyableNoteText(title, body))
  }

  function viewRaw(): Promise<void> {
    return openRaw('')
  }

  function downloadRaw(): Promise<void> {
    return openRaw('?download')
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
      await Promise.allSettled([...inflightImages])
      const flushed = await autosave.flush()
      if (!flushed) return
      if (!(await commitFormat())) return
      close()
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
   * browsers). The route is cleared right away and the unmount flushes
   * anything left (`onDestroy`). Waiting for a flush here would leave `?note`
   * pointing at a closed dialog, and a card opened in that window would
   * reuse this instance and then be closed by the late `onclose`.
   */
  function handleDialogClose(): void {
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
      <button type="button" class="icon-button" aria-label={m.editor.close} title={m.editor.close} onclick={requestClose}>
        <Icon name="close" />
      </button>
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
        <button type="button" onclick={toggleFormat}>
          {showsDefault(format, pendingFormat, settings().defaultFormat) ? m.editor.formatDefault(formatLabel) : formatLabel}
        </button>
        <button type="button" onclick={openImageUrlDialog}>{m.editor.insertImageFromUrl}</button>
      </div>
    {/if}

    {#if showTextarea}
      <textarea
        bind:this={textareaEl}
        class="note-editor-body"
        class:mono={effective === 'syntax'}
        placeholder={m.editor.takeANote}
        bind:value={body}
        oninput={onBodyInput}
        onpaste={handlePaste}
        readonly={readOnly}
      ></textarea>
    {:else if LiveEditorComponent}
      <LiveEditorComponent
        bind:this={liveEl}
        bind:value={body}
        onchange={onBodyInput}
        onpaste={handlePaste}
        readonly={readOnly}
        placeholder={m.editor.takeANote}
      />
    {:else}
      <div class="note-editor-body"></div>
    {/if}

    {#each imageTasks as task (task.token)}
      <p class="note-editor-status" class:error={task.status === 'error'}>
        {task.status === 'uploading' ? m.editor.imageUploading : m.editor.imageFailed(task.error ?? '')}
        {#if task.status === 'error'}
          <button type="button" class="note-editor-image-dismiss" onclick={() => dismissImageTask(task.token)}>
            {m.editor.dismiss}
          </button>
        {/if}
      </p>
    {/each}

    <div class="note-editor-footer">
      {#if saveError}
        <p class="note-editor-status error">{saveError}</p>
      {:else if readOnly}
        <p class="note-editor-status">{m.editor.readOnlyTrashed}</p>
      {:else if status === 'saving'}
        <p class="note-editor-status">{m.editor.saving}</p>
      {:else if status === 'saved'}
        <p class="note-editor-status">{m.editor.saved}</p>
      {/if}
      {#if noteId && updatedAt !== null}
        <span class="note-editor-edited" title={formatFullTimestamp(updatedAt, locale())}>
          {m.editor.lastModified(formatEdited(updatedAt, locale(), Date.now()))}
        </span>
      {/if}
    </div>

    <div class="note-editor-actions">
      {#if readOnly}
        <button type="button" class="icon-button" aria-label={m.editor.restore} title={m.editor.restore} onclick={restore}>
          <Icon name="restore" />
        </button>
        <button
          type="button"
          class="icon-button danger"
          aria-label={m.editor.deleteForever}
          title={m.editor.deleteForever}
          onclick={deleteForever}
        >
          <Icon name="deleteForever" />
        </button>
      {:else}
        <button
          type="button"
          class="icon-button"
          disabled={!noteId}
          aria-label={pinned ? m.editor.unpin : m.editor.pin}
          title={pinned ? m.editor.unpin : m.editor.pin}
          aria-pressed={pinned}
          onclick={togglePinned}
        >
          <Icon name="pin" filled={pinned} />
        </button>
        <button
          type="button"
          class="icon-button"
          disabled={!noteId}
          aria-label={archived ? m.editor.unarchive : m.editor.archive}
          title={archived ? m.editor.unarchive : m.editor.archive}
          onclick={toggleArchived}
        >
          <Icon name={archived ? 'unarchive' : 'archive'} />
        </button>
        <button
          type="button"
          class="icon-button"
          disabled={!noteId}
          aria-label={m.editor.moveTo}
          title={m.editor.moveToCurrent(currentFolderName)}
          onclick={() => (pickingFolder = true)}
        >
          <Icon name="move" />
        </button>
        <button
          type="button"
          class="icon-button"
          disabled={!noteId}
          aria-label={m.editor.trash}
          title={m.editor.trash}
          onclick={moveToTrash}
        >
          <Icon name="trash" />
        </button>
      {/if}
      <button type="button" class="icon-button" aria-label={copyLabel} title={copyLabel} onclick={copyNote}>
        <Icon name={copyAction.state === 'copied' ? 'check' : 'copy'} />
      </button>
      <button
        type="button"
        class="icon-button"
        disabled={!noteId}
        aria-label={m.editor.viewRaw}
        title={m.editor.viewRaw}
        onclick={viewRaw}
      >
        <Icon name="viewRaw" />
      </button>
      <button
        type="button"
        class="icon-button"
        disabled={!noteId}
        aria-label={m.editor.downloadMarkdown}
        title={m.editor.downloadMarkdown}
        onclick={downloadRaw}
      >
        <Icon name="download" />
      </button>
      <span class="note-editor-spacer"></span>
      <button type="button" class="icon-button" aria-label={m.editor.close} title={m.editor.close} onclick={requestClose}>
        <Icon name="close" />
      </button>
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

{#if urlDialogOpen}
  <ImageUrlDialog oninsert={handleImageUrlInsert} oncancel={() => (urlDialogOpen = false)} />
{/if}

<style>
  .note-editor {
    width: min(900px, 92vw);
    max-height: 90vh;
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

  .note-editor-footer {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    min-height: 1.2em;
  }

  .note-editor-edited {
    margin-left: auto;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .note-editor-image-dismiss {
    margin-left: 6px;
    font-size: 0.8rem;
  }

  .note-editor-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .note-editor-spacer {
    flex: 1;
  }

  .note-editor-actions .danger {
    color: var(--danger);
  }

  @media (max-width: 720px) {
    .note-editor {
      /* The UA's dialog:modal centring and max sizes must all be undone. */
      margin: 0;
      /* iOS ignores interactive-widget, so the box follows the visual viewport variables. */
      inset: var(--vv-top, 0px) 0 auto 0;
      width: 100%;
      max-width: none;
      height: var(--vv-height, 100dvh);
      max-height: none;
      border: 0;
      border-radius: 0;
      padding: 12px;
      gap: 8px;
    }

    .note-editor-body {
      min-height: 0;
      resize: none;
    }

    .note-editor-toolbar {
      flex-wrap: wrap;
    }

    /* liveTheme (lib/live/decorations.ts) pins the editor to 40vh-60vh; this selector out-ranks its single generated class. */
    .note-editor :global(.live-editor) {
      min-height: 0;
    }

    .note-editor :global(.live-editor .cm-editor) {
      flex: 1;
      min-height: 0;
      max-height: none;
    }
  }

  /* At 0.85rem, iOS zooms the page when this field gets focus. */
  @media (pointer: coarse) {
    .note-editor-labels {
      font-size: 16px;
    }
  }
</style>
