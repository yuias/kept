<script lang="ts">
  import { messages } from '../../lib/i18n.svelte'
  import { imageView } from '../../lib/lexical/nodes/image-node'

  const { src, alt }: { src: string; alt: string } = $props()

  const m = $derived(messages())
  const view = $derived(imageView(src, alt))
</script>

{#if view === 'local'}
  <img class="rich-image-img" {src} {alt} draggable="false" />
{:else if view === 'uploading'}
  <span class="rich-image-uploading">{m.editor.imageUploading}</span>
{:else}
  <!-- Not fetched: an external image would leak the reader's address and break on mixed content. -->
  <span class="rich-image-external">{alt} <span class="rich-image-url">{src}</span></span>
{/if}
