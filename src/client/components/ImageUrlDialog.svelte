<script lang="ts">
  import { onMount } from 'svelte'
  import { messages } from '../lib/i18n.svelte'

  const { oninsert, oncancel }: { oninsert: (url: string) => void; oncancel: () => void } = $props()

  const m = $derived(messages())

  let dialogEl: HTMLDialogElement | undefined
  let inputEl: HTMLInputElement | undefined
  let url = $state('')

  // `undefined` distinguishes "closed via Insert" from Cancel/Esc, the same
  // pattern FolderPicker uses for its own dialog.
  let submitted: string | undefined

  onMount(() => {
    dialogEl?.showModal()
    inputEl?.focus()
  })

  function submit(): void {
    const trimmed = url.trim()
    if (!trimmed) return
    submitted = trimmed
    dialogEl?.close()
  }

  function handleClose(): void {
    if (submitted !== undefined) oninsert(submitted)
    else oncancel()
  }
</script>

<dialog bind:this={dialogEl} class="image-url-dialog" onclose={handleClose}>
  <h2 class="image-url-dialog-title">{m.imageUrlDialog.title}</h2>
  <form
    onsubmit={(event) => {
      event.preventDefault()
      submit()
    }}
  >
    <input
      bind:this={inputEl}
      class="image-url-dialog-input"
      type="url"
      placeholder={m.imageUrlDialog.urlPlaceholder}
      bind:value={url}
    />
    <div class="image-url-dialog-actions">
      <span class="image-url-dialog-spacer"></span>
      <button type="button" onclick={() => dialogEl?.close()}>{m.folders.cancel}</button>
      <button type="submit" disabled={!url.trim()}>{m.imageUrlDialog.insert}</button>
    </div>
  </form>
</dialog>

<style>
  .image-url-dialog {
    width: min(420px, 90vw);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .image-url-dialog-title {
    margin: 0;
    font-size: 1rem;
  }

  .image-url-dialog-input {
    width: 100%;
    box-sizing: border-box;
  }

  .image-url-dialog-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .image-url-dialog-spacer {
    flex: 1;
  }
</style>
