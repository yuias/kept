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
  // @jsquash/webp's emscripten glue locates its wasm file with
  // `new URL('*.wasm', import.meta.url)`; esbuild's dev-time pre-bundling
  // does not preserve that pattern, so the dependency is excluded from it.
  optimizeDeps: { exclude: ['@jsquash/webp'] },
  // @jsquash/webp's `encode()` dynamically imports the SIMD or non-SIMD codec
  // glue depending on feature detection; that code-splitting only works
  // inside an ES module worker, not Vite's default classic/IIFE format.
  worker: { format: 'es' },
})
