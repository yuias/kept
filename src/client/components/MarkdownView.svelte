<script lang="ts">
  import { highlightCodeBlocks, renderMarkdown } from '../lib/markdown'

  const { source }: { source: string } = $props()

  const html = $derived(renderMarkdown(source))

  let container = $state<HTMLElement | null>(null)

  $effect(() => {
    // Re-run whenever the rendered markup changes.
    void html
    const element = container
    if (!element) return

    let cancelled = false
    void highlightCodeBlocks(element).catch(() => {
      if (!cancelled) return
    })

    return () => {
      cancelled = true
    }
  })
</script>

<!-- `html` is sanitized by DOMPurify in renderMarkdown. -->
<div class="markdown" bind:this={container}>{@html html}</div>
