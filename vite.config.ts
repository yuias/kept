import { cloudflare } from '@cloudflare/vite-plugin'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte(), cloudflare()],
  build: {
    // Shiki grammars are code-split into their own chunks; they are large by
    // nature and the warning is pure noise here.
    chunkSizeWarningLimit: 1500,
  },
})
