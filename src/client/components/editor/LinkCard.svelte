<script lang="ts">
  import type { LinkPreview } from '../../../shared/types'
  import { messages } from '../../lib/i18n.svelte'
  import { loadLinkPreview, peekLinkPreview, proxiedImageSrc } from '../../lib/link-preview'

  const {
    url,
    readOnly,
    onseturl,
    onselect,
    onfocuseditor,
  }: {
    url: string
    readOnly: boolean
    /** True when the value was accepted (an empty one removes the card); false keeps the input open. */
    onseturl: (url: string) => boolean
    onselect: () => void
    onfocuseditor: () => void
  } = $props()

  const m = $derived(messages())

  let fetched = $state<{ url: string; preview: LinkPreview }>()
  const preview = $derived(peekLinkPreview(url) ?? (fetched?.url === url ? fetched.preview : undefined))

  $effect(() => {
    const target = url
    if (peekLinkPreview(target)) return
    let stale = false
    // A rejection leaves the placeholder; the next card draw asks again.
    loadLinkPreview(target).then(
      (loaded) => {
        if (!stale) fetched = { url: target, preview: loaded }
      },
      () => {},
    )
    return () => {
      stale = true
    }
  })

  let thumbBroken = $state(false)
  let faviconBroken = $state(false)

  function hostnameOf(value: string): string {
    try {
      return new URL(value).hostname
    } catch {
      return value
    }
  }

  let editing = $state(false)
  let draft = $state('')
  let invalid = $state(false)

  function startEdit(event: MouseEvent): void {
    event.stopPropagation()
    draft = url
    invalid = false
    editing = true
  }

  function commit(): void {
    if (onseturl(draft)) {
      editing = false
      onfocuseditor()
    } else {
      invalid = true
    }
  }

  function cancel(): void {
    editing = false
    onfocuseditor()
  }

  function isHttpUrl(value: string): boolean {
    try {
      const { protocol } = new URL(value)
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      // Not an absolute URL.
      return false
    }
  }

  function open(event: MouseEvent): void {
    // The second click of a double-click would open a second tab.
    if (editing || event.detail > 1) return
    if (!readOnly) onselect()
    // A card pasted as Lexical clipboard JSON skips the markdown importer's http(s) check.
    if (!isHttpUrl(url)) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // The input sits inside the editor's root, so its events must not reach Lexical: its
  // Backspace would remove a selected card and its Enter would split the paragraph. Native
  // listeners, because Svelte's delegated ones run after the root's.
  const FIELD_EVENTS = [
    'keyup',
    'beforeinput',
    'paste',
    'cut',
    'copy',
    'compositionstart',
    'compositionend',
    'pointerdown',
    'mousedown',
    'click',
  ]

  function field(node: HTMLInputElement) {
    const stop = (event: Event): void => event.stopPropagation()
    const keydown = (event: KeyboardEvent): void => {
      event.stopPropagation()
      // Enter that confirms an IME conversion is not a commit.
      if (event.isComposing) return
      if (event.key !== 'Enter' && event.key !== 'Escape') return
      // Esc also closes the note's dialog unless its default is prevented.
      event.preventDefault()
      if (event.key === 'Enter') commit()
      else cancel()
    }
    const input = (event: Event): void => {
      event.stopPropagation()
      invalid = false
    }
    node.addEventListener('keydown', keydown)
    node.addEventListener('input', input)
    for (const type of FIELD_EVENTS) node.addEventListener(type, stop)
    node.focus()
    node.select()
    return {
      destroy() {
        node.removeEventListener('keydown', keydown)
        node.removeEventListener('input', input)
        for (const type of FIELD_EVENTS) node.removeEventListener(type, stop)
      },
    }
  }
</script>

<!-- A pointer target only: the card is reached from the keyboard by selecting it in the editor. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="rich-card-box"
  data-url={url}
  title={url}
  onmousedown={(event) => event.preventDefault()}
  onclick={open}
>
  {#if preview?.image && !thumbBroken}
    <img
      class="rich-card-thumb"
      alt=""
      draggable="false"
      loading="lazy"
      src={proxiedImageSrc(preview.image)}
      onerror={() => (thumbBroken = true)}
    />
  {/if}
  <div class="rich-card-body">
    <div class="rich-card-title">{preview?.title || preview?.siteName || hostnameOf(url)}</div>
    {#if preview?.description}
      <div class="rich-card-desc">{preview.description}</div>
    {/if}
    <div class="rich-card-url">
      {#if preview?.favicon && !faviconBroken}
        <img
          class="rich-card-favicon"
          alt=""
          draggable="false"
          src={proxiedImageSrc(preview.favicon)}
          onerror={() => (faviconBroken = true)}
        />
      {/if}
      {#if editing}
        <input
          class="rich-card-input"
          type="text"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          aria-label={m.editor.editCard}
          aria-invalid={invalid}
          bind:value={draft}
          onblur={() => (editing = false)}
          use:field
        />
      {:else}
        <span>{url}</span>
      {/if}
    </div>
  </div>
  {#if !readOnly && !editing}
    <button type="button" class="rich-card-edit" aria-label={m.editor.editCard} title={m.editor.editCard} onclick={startEdit}>&#x270e;</button>
  {/if}
</div>
