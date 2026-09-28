<script lang="ts">
  import type { ListQuery } from '../lib/routes'

  // Placeholder until the note grid and list loading exist.
  let { query }: { query: ListQuery } = $props()
</script>

<pre>{JSON.stringify(query)}</pre>
