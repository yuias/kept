<script lang="ts">
  import { ICON_PATHS, type IconName } from '../lib/icons'

  interface Props {
    name: IconName
    size?: number
    filled?: boolean
  }

  const { name, size = 16, filled = false }: Props = $props()
</script>

<svg
  class="icon"
  viewBox="0 0 16 16"
  width={size}
  height={size}
  aria-hidden="true"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="1.4"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#each ICON_PATHS[name] as d (d)}
    <path {d} />
  {/each}
</svg>
