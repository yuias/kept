import { $isListItemNode, $isListNode } from '@lexical/list'
import { calculateZoomLevel } from '@lexical/utils'
import { $getNearestNodeFromDOMNode } from 'lexical'
import { mount, unmount } from 'svelte'
import PasteChoice from '../../components/editor/PasteChoice.svelte'
import { createCardOps } from './cards'
import { createEditorCore, type EditorCore, type EditorCoreOptions } from './core'
import { mountDecorators } from './decorators'
import { isCheckMarkHit, toggleTask } from './tasks'

// A tap fires `pointerup` and then a synthesized `click`; the second is ignored.
const TAP_DEDUPE_MS = 500

export interface RichEditorOptions extends EditorCoreOptions {
  root: HTMLElement
}

export type RichEditorHandle = Omit<EditorCore, 'editor' | 'gate' | 'urlPaste'>

export function createRichEditor({ root, ...options }: RichEditorOptions): RichEditorHandle {
  const core = createEditorCore(options)
  core.editor.setRootElement(root)
  const stopDecorators = mountDecorators(core.editor, createCardOps(core.editor, core.gate))
  // Lexical never writes `contenteditable`, so an uneditable root would still take input.
  const syncEditable = (editable: boolean): void => {
    root.contentEditable = String(editable)
  }
  syncEditable(core.editor.isEditable())
  const stopEditable = core.editor.registerEditableListener(syncEditable)
  // After Lexical's own handlers on the same events, so the composed text is committed first.
  const begin = (): void => core.gate.begin()
  const end = (): void => core.gate.end()
  root.addEventListener('compositionstart', begin)
  root.addEventListener('compositionend', end)

  // Lexical's check list ignores clicks while the editor is not editable, so a locked
  // note toggles its tasks here. While editable the stock handlers do it instead.
  let tasksToggleable = options.tasksToggleable
  const lastTouch = new WeakMap<EventTarget, number>()
  const toggleAt = (event: MouseEvent): void => {
    if (core.editor.isEditable() || !tasksToggleable) return
    const item = event.target
    if (!(item instanceof HTMLElement) || item.parentElement?.tagName !== 'UL') return
    // A wrapper item that holds a sublist has no mark of its own.
    if (item.firstElementChild?.tagName === 'UL' || item.firstElementChild?.tagName === 'OL') return
    const rect = item.getBoundingClientRect()
    const hit = isCheckMarkHit({
      clientX: event.clientX,
      left: rect.left,
      right: rect.right,
      markerWidth: parseFloat(getComputedStyle(item, '::before').width),
      rtl: item.dir === 'rtl',
      touch: event instanceof PointerEvent && event.pointerType === 'touch',
      zoom: calculateZoomLevel(item),
    })
    if (!hit) return
    const key = core.editor.read(() => {
      const node = $getNearestNodeFromDOMNode(item)
      const list = $isListItemNode(node) ? node.getParent() : null
      return $isListItemNode(node) && $isListNode(list) && list.getListType() === 'check' ? node.getKey() : null
    })
    if (key !== null) toggleTask(core.editor, core.gate, key)
  }
  const recentTouch = (event: Event): boolean => {
    const last = event.target ? lastTouch.get(event.target) : undefined
    return last !== undefined && event.timeStamp - last < TAP_DEDUPE_MS
  }
  const onTaskClick = (event: MouseEvent): void => {
    if (!recentTouch(event)) toggleAt(event)
  }
  const onTaskPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || recentTouch(event)) return
    if (event.target) lastTouch.set(event.target, event.timeStamp)
    toggleAt(event)
  }
  root.addEventListener('click', onTaskClick)
  root.addEventListener('pointerup', onTaskPointerUp)

  // Inside the wrapper, not on the body: a modal dialog makes everything outside it inert.
  // The root scrolls on its own, so the popup follows its paragraph on scroll.
  const wrapper = root.parentElement!
  let popup: { host: HTMLElement; component: Record<string, unknown>; key: string } | null = null
  const place = (): void => {
    if (!popup) return
    const line = core.editor.getElementByKey(popup.key)?.getBoundingClientRect()
    if (!line) return core.urlPaste.close()
    const area = root.getBoundingClientRect()
    const frame = wrapper.getBoundingClientRect()
    popup.host.hidden = line.bottom < area.top || line.bottom > area.bottom
    popup.host.style.top = `${line.bottom - frame.top + 2}px`
    popup.host.style.left = `${line.left - frame.left}px`
  }
  const closePopup = (): void => {
    if (!popup) return
    void unmount(popup.component)
    popup.host.remove()
    popup = null
  }
  const stopPasteChoice = core.urlPaste.subscribe((pending) => {
    closePopup()
    if (!pending) return
    const host = document.createElement('div')
    host.style.position = 'absolute'
    host.style.zIndex = '5'
    wrapper.append(host)
    const component = mount(PasteChoice, {
      target: host,
      props: { onlink: () => core.urlPaste.close(), oncard: () => core.urlPaste.chooseCard() },
    })
    popup = { host, component, key: pending.key }
    place()
  })
  const closeChoice = (): void => core.urlPaste.close()
  root.addEventListener('focusout', closeChoice)
  root.addEventListener('scroll', place)

  return {
    insertText: (s) => core.insertText(s),
    replaceText: (token, s) => core.replaceText(token, s),
    focus: () => core.focus(),
    setValue: (markdown) => core.setValue(markdown),
    setReadOnly: (readOnly, toggleable) => {
      tasksToggleable = toggleable
      core.setReadOnly(readOnly, toggleable)
    },
    destroy() {
      root.removeEventListener('click', onTaskClick)
      root.removeEventListener('pointerup', onTaskPointerUp)
      stopPasteChoice()
      closePopup()
      root.removeEventListener('focusout', closeChoice)
      root.removeEventListener('scroll', place)
      stopEditable()
      stopDecorators()
      root.removeEventListener('compositionstart', begin)
      root.removeEventListener('compositionend', end)
      core.editor.setRootElement(null)
      core.destroy()
    },
  }
}
