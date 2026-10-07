<script lang="ts">
  import { onMount } from 'svelte'
  import { messages } from '../lib/i18n.svelte'
  import { SIGN_OUT_URL, type SessionLoss, dismissSessionLoss } from '../lib/session.svelte'

  const { kind }: { kind: SessionLoss } = $props()

  const m = $derived(messages())

  let dialogEl: HTMLDialogElement | undefined

  onMount(() => {
    dialogEl?.showModal()
  })

  // Reloading in place sends the navigation through Access, which signs the
  // user in and returns them to the same note.
  function signIn(): void {
    location.reload()
  }
</script>

<!-- Esc and "Not now" stay available so unsaved text can still be copied
     out of the editor; the next failing request brings the dialog back. -->
<dialog
  bind:this={dialogEl}
  class="session-lost-dialog"
  aria-labelledby="session-lost-title"
  aria-describedby="session-lost-body"
  onclose={dismissSessionLoss}
>
  <h2 id="session-lost-title" class="session-lost-title">
    {kind === 'stale' ? m.sessionDialog.staleTitle : m.sessionDialog.expiredTitle}
  </h2>
  <p id="session-lost-body" class="session-lost-body">
    {kind === 'stale' ? m.sessionDialog.staleBody : m.sessionDialog.expiredBody}
  </p>
  <div class="session-lost-actions">
    <button type="button" onclick={() => dialogEl?.close()}>{m.sessionDialog.later}</button>
    <!-- svelte-ignore a11y_autofocus -->
    {#if kind === 'stale'}
      <a class="button primary" href={SIGN_OUT_URL} autofocus>{m.sessionDialog.signOut}</a>
    {:else}
      <button type="button" class="primary" autofocus onclick={signIn}>
        {m.sessionDialog.signIn}
      </button>
    {/if}
  </div>
</dialog>

<style>
  .session-lost-dialog {
    width: min(400px, calc(100vw - 32px));
    padding: 20px;
  }

  /* Darker than the shared backdrop, which lightens in the light theme: this
     one has to read as "the app is unavailable" in both. */
  .session-lost-dialog::backdrop {
    background: rgb(0 0 0 / 0.55);
  }

  .session-lost-title {
    margin: 0 0 8px;
    font-size: 1.05rem;
  }

  .session-lost-body {
    margin: 0 0 18px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .session-lost-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
