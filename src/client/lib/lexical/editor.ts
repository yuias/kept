import { $isListItemNode, $isListNode } from '@lexical/list'
import { $isAutoLinkNode, $isLinkNode, type LinkNode } from '@lexical/link'
import { $findMatchingParent, calculateZoomLevel } from '@lexical/utils'
import { $getNearestNodeFromDOMNode, $getSelection, $isRangeSelection } from 'lexical'
import { mount, unmount } from 'svelte'
import PasteChoice from '../../components/editor/PasteChoice.svelte'
import { linkHref } from '../link-href'
import { createCardOps } from './cards'
import { createEditorCore, type EditorCore, type EditorCoreOptions } from './core'
import { mountDecorators } from './decorators'
import { linkClickAction } from './link-click'
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

  // Own handlers instead of ClickableLinkExtension, which ignores read-only and opens targets
  // `linkHref` rejects. An unlinked auto link renders as plain text, so it is not a link here.
  // The caret is read on the capture `pointerdown`, before the browser moves it onto the link.
  let caretInLink = false
  const $linkUnder = (target: EventTarget | null): LinkNode | null => {
    const node = target instanceof Node ? $getNearestNodeFromDOMNode(target) : null
    return node && $findMatchingParent(node, (n): n is LinkNode => $isLinkNode(n) && !($isAutoLinkNode(n) && n.getIsUnlinked()))
  }
  const onLinkPointerDown = (event: PointerEvent): void => {
    // A caret left in the link while the editor was blurred is not one the user just placed.
    caretInLink = root.contains(document.activeElement) && core.editor.read(() => {
      const link = $linkUnder(event.target)
      const selection = $getSelection()
      if (!link || !$isRangeSelection(selection) || !selection.isCollapsed()) return false
      return $findMatchingParent(selection.anchor.getNode(), (n) => n.is(link)) !== null
    })
  }
  const onLinkClick = (event: MouseEvent): void => {
    // `click` is the primary button only; `auxclick` also fires for the context menu button.
    if (event.button !== (event.type === 'auxclick' ? 1 : 0)) return
    const url = core.editor.read(() => $linkUnder(event.target)?.getURL() ?? null)
    if (url === null) return
    // A read-only root is not contenteditable, so the anchor would navigate natively.
    event.preventDefault()
    const href = linkHref(url)
    const action = linkClickAction({
      readOnly: !core.editor.isEditable(),
      modifier: event.ctrlKey || event.metaKey || event.button === 1,
      caretInLink,
      detail: event.detail,
      href,
    })
    caretInLink = false
    if (action === 'open' && href !== null) window.open(href, '_blank', 'noopener,noreferrer')
  }
  root.addEventListener('pointerdown', onLinkPointerDown, true)
  root.addEventListener('click', onLinkClick)
  root.addEventListener('auxclick', onLinkClick)

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
      root.removeEventListener('pointerdown', onLinkPointerDown, true)
      root.removeEventListener('click', onLinkClick)
      root.removeEventListener('auxclick', onLinkClick)
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
