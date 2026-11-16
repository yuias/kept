import type { LexicalEditor, NodeKey } from 'lexical'
import { mount, unmount } from 'svelte'
import EditorImage from '../../components/editor/EditorImage.svelte'
import type { CardDecoration } from './nodes/card-node'
import type { ImageDecoration } from './nodes/image-node'

type Decoration = ImageDecoration | CardDecoration

interface Mounted {
  decoration: Decoration
  element: HTMLElement
  component: Record<string, unknown>
}

/**
 * Renders each decorator node's `decorate()` data with a Svelte component
 * inside the node's element. Cards have no view yet and stay empty. Returns a
 * function that unmounts everything.
 */
export function mountDecorators(editor: LexicalEditor): () => void {
  const mounted = new Map<NodeKey, Mounted>()

  const release = (key: NodeKey): void => {
    const entry = mounted.get(key)
    if (!entry) return
    mounted.delete(key)
    void unmount(entry.component)
  }

  const sync = (decorators: Record<NodeKey, Decoration>): void => {
    for (const key of [...mounted.keys()]) if (!(key in decorators)) release(key)
    for (const [key, decoration] of Object.entries(decorators)) {
      if (decoration.kind !== 'image') continue
      const element = editor.getElementByKey(key)
      if (!element) continue
      const entry = mounted.get(key)
      // `decorate()` returns a new object on every update, so compare the data.
      // A new element means Lexical recreated the node's DOM.
      const previous = entry?.decoration
      if (entry && entry.element === element && previous?.kind === 'image' && previous.src === decoration.src && previous.alt === decoration.alt) {
        continue
      }
      release(key)
      mounted.set(key, {
        decoration,
        element,
        component: mount(EditorImage, { target: element, props: { src: decoration.src, alt: decoration.alt } }),
      })
    }
  }

  const stop = editor.registerDecoratorListener<Decoration>(sync)
  sync(editor.getDecorators<Decoration>())
  return () => {
    stop()
    for (const key of [...mounted.keys()]) release(key)
  }
}
