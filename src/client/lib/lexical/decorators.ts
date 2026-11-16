import { $getSelection, $isNodeSelection, type LexicalEditor, type NodeKey } from 'lexical'
import { mount, unmount } from 'svelte'
import EditorImage from '../../components/editor/EditorImage.svelte'
import LinkCard from '../../components/editor/LinkCard.svelte'
import type { CardOps } from './cards'
import type { CardDecoration } from './nodes/card-node'
import type { ImageDecoration } from './nodes/image-node'

type Decoration = ImageDecoration | CardDecoration

interface Mounted {
  decoration: Decoration
  element: HTMLElement
  readOnly: boolean
  component: Record<string, unknown>
}

const CARD_SELECTED_CLASS = 'rich-card-selected'

/**
 * Renders each decorator node's `decorate()` data with a Svelte component
 * inside the node's element. Returns a function that unmounts everything.
 */
export function mountDecorators(editor: LexicalEditor, cards: CardOps): () => void {
  const mounted = new Map<NodeKey, Mounted>()

  const release = (key: NodeKey): void => {
    const entry = mounted.get(key)
    if (!entry) return
    mounted.delete(key)
    void unmount(entry.component)
  }

  const render = (key: NodeKey, decoration: Decoration, element: HTMLElement, readOnly: boolean): Record<string, unknown> => {
    if (decoration.kind === 'image') {
      return mount(EditorImage, { target: element, props: { src: decoration.src, alt: decoration.alt } })
    }
    return mount(LinkCard, {
      target: element,
      props: {
        url: decoration.url,
        readOnly,
        onseturl: (url: string) => cards.setUrl(key, url),
        onselect: () => cards.select(key),
        // After the input is gone the focus would fall to the page; `focus()` alone does not
        // take it for a node-selected card.
        onfocuseditor: () => {
          editor.getRootElement()?.focus({ preventScroll: true })
          editor.focus()
        },
      },
    })
  }

  const isSame = (a: Decoration, b: Decoration): boolean =>
    a.kind === 'image' ? b.kind === 'image' && a.src === b.src && a.alt === b.alt : b.kind === 'card' && a.url === b.url

  const sync = (decorators: Record<NodeKey, Decoration>): void => {
    const readOnly = !editor.isEditable()
    for (const key of [...mounted.keys()]) if (!(key in decorators)) release(key)
    for (const [key, decoration] of Object.entries(decorators)) {
      const element = editor.getElementByKey(key)
      if (!element) continue
      const entry = mounted.get(key)
      // `decorate()` returns a new object on every update, so compare the data.
      // A new element means Lexical recreated the node's DOM. Only a card shows
      // whether the editor is editable.
      if (entry && entry.element === element && isSame(entry.decoration, decoration) && (decoration.kind === 'image' || entry.readOnly === readOnly)) {
        continue
      }
      release(key)
      mounted.set(key, { decoration, element, readOnly, component: render(key, decoration, element, readOnly) })
    }
  }

  // Lexical selects a card as a node but leaves it unmarked.
  const markSelected = (): void => {
    const selected = editor.getEditorState().read(() => {
      const selection = $getSelection()
      return $isNodeSelection(selection) ? selection.getNodes().map((node) => node.getKey()) : []
    })
    for (const [key, entry] of mounted) {
      if (entry.decoration.kind === 'card') entry.element.classList.toggle(CARD_SELECTED_CLASS, selected.includes(key))
    }
  }

  const stop = editor.registerDecoratorListener<Decoration>(sync)
  // The decorators do not change when the editor turns read-only, but the cards' edit button does.
  const stopEditable = editor.registerEditableListener(() => sync(editor.getDecorators<Decoration>()))
  // After the reconciler has written the DOM, so the elements of new cards exist.
  const stopSelection = editor.registerUpdateListener(markSelected)
  sync(editor.getDecorators<Decoration>())
  markSelected()
  return () => {
    stop()
    stopEditable()
    stopSelection()
    for (const key of [...mounted.keys()]) release(key)
  }
}
