<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import { isOutsideRect } from '../lib/dialog'
  import { closeDrawer } from '../lib/sidebar.svelte'

  const { label, children }: { label: string; children: Snippet } = $props()

  let dialogEl: HTMLDialogElement | undefined

  // Same rule as the note editor: a backdrop tap only counts when the press
  // also started on the backdrop, so a drag that ends outside does not close it.
  let pointerDownOnBackdrop = false

  function isBackdropEvent(event: MouseEvent): boolean {
    const el = dialogEl
    if (!el) return false
    // With showModal(), a click on the dialog's own padding also has
    // target === dialogEl, so only a point outside its box is the backdrop.
    return event.target === el && isOutsideRect(el.getBoundingClientRect(), event.clientX, event.clientY)
  }

  function handlePointerDown(event: PointerEvent): void {
    pointerDownOnBackdrop = event.button === 0 && isBackdropEvent(event)
  }

  function handleClick(event: MouseEvent): void {
    const started = pointerDownOnBackdrop
    pointerDownOnBackdrop = false
    if (started && isBackdropEvent(event)) {
      closeDrawer()
      return
    }
    // navigate() ignores a link to the current URL, so the route effect alone
    // would leave the drawer open after tapping the page you are already on.
    if (event.target instanceof Element && event.target.closest('a[href]')) closeDrawer()
  }

  onMount(() => {
    const el = dialogEl
    el?.showModal()
    // Attached here rather than in markup to avoid a11y warnings for click
    // handlers on <dialog>; Esc already covers keyboard users.
    el?.addEventListener('pointerdown', handlePointerDown)
    el?.addEventListener('click', handleClick)
    return () => {
      el?.removeEventListener('pointerdown', handlePointerDown)
      el?.removeEventListener('click', handleClick)
    }
  })
</script>

<!-- Esc and Android Back run the default cancel action, which closes the dialog
     and lands in onclose; every other path only sets state and the unmount
     removes the dialog, so nothing here calls close() directly. -->
<dialog bind:this={dialogEl} class="sidebar-drawer" aria-label={label} onclose={closeDrawer}>
  {@render children()}
</dialog>
