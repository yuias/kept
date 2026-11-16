import { $isListItemNode, $isListNode } from '@lexical/list'
import { $isAutoLinkNode, $isLinkNode, type LinkNode } from '@lexical/link'
import { $findMatchingParent, calculateZoomLevel, mergeRegister } from '@lexical/utils'
import {
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  type NodeKey,
} from 'lexical'
import { mount, unmount } from 'svelte'
import EmojiMenu, { type EmojiMenuState } from '../../components/editor/EmojiMenu.svelte'
import FormatBar from '../../components/editor/FormatBar.svelte'
import PasteChoice from '../../components/editor/PasteChoice.svelte'
import TableActions, { type TableAction } from '../../components/editor/TableActions.svelte'
import { linkHref } from '../link-href'
import { createCardOps } from './cards'
import { createEditorCore, type EditorCore, type EditorCoreOptions } from './core'
import { mountDecorators } from './decorators'
import { type EmojiEntry, loadedEmojiIndex, loadEmojiIndex, matchEmoji, pickEmoji, shortcodeQuery } from './emoji'
import { applyLink, formatBarState, type FormatBarState, removeLink, toggleFormat } from './format'
import { linkClickAction } from './link-click'
import { deleteColumn, deleteRow, insertColumnRight, insertRowBelow, tableAtCaret } from './tables'
import { isCheckMarkHit, toggleTask } from './tasks'

// A tap fires `pointerup` and then a synthesized `click`; the second is ignored.
const TAP_DEDUPE_MS = 500

// Space between the selection and the format bar. Below the selection on touch screens the
// native selection menu sits above it, and the selection handles hang below its end.
const BAR_GAP = 6
const BAR_TOUCH_GAP = 28

// Space between the table and its actions button.
const TABLE_BUTTON_GAP = 2

// Space between the shortcode and the emoji menu, and the number of suggestions it lists.
const EMOJI_GAP = 2
const EMOJI_LIMIT = 8

const TABLE_ACTIONS: Record<TableAction, typeof insertRowBelow> = {
  insertRow: insertRowBelow,
  insertColumn: insertColumnRight,
  deleteRow,
  deleteColumn,
}

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

  // The format bar follows the selection. It is mounted only while shown, so the link field
  // starts closed each time. The DOM range is kept because the selection leaves the editor
  // while the link field has the focus.
  const coarse = window.matchMedia('(pointer: coarse)')
  const barListeners = new Set<(active: FormatBarState['active']) => void>()
  let barActive: FormatBarState['active'] = new Set()
  let bar: { host: HTMLElement; component: Record<string, unknown>; range: Range; resize: ResizeObserver } | null = null
  const focusEditor = (): void => {
    root.focus({ preventScroll: true })
    core.editor.focus()
  }
  const placeBar = (): void => {
    if (!bar) return
    const rects = bar.range.getClientRects()
    const first = rects[0] ?? bar.range.getBoundingClientRect()
    const last = rects[rects.length - 1] ?? first
    const area = root.getBoundingClientRect()
    const frame = wrapper.getBoundingClientRect()
    bar.host.hidden = last.bottom < area.top || first.top > area.bottom
    if (bar.host.hidden) return
    const { offsetWidth: width, offsetHeight: height } = bar.host
    const above = { top: first.top - height - BAR_GAP, left: first.left }
    const below = { top: last.bottom + (coarse.matches ? BAR_TOUCH_GAP : BAR_GAP), left: last.left }
    const fits = (spot: { top: number }): boolean => spot.top >= area.top && spot.top + height <= area.bottom
    const spots = coarse.matches ? [below, above] : [above, below]
    const spot = spots.find(fits) ?? spots[0]!
    bar.host.style.top = `${spot.top - frame.top}px`
    bar.host.style.left = `${Math.max(0, Math.min(spot.left - frame.left, frame.width - width))}px`
  }
  const closeBar = (): void => {
    if (!bar) return
    // Cleared first: removing the focused link field fires `focusout`, which closes again.
    const closing = bar
    bar = null
    closing.resize.disconnect()
    void unmount(closing.component)
    closing.host.remove()
  }
  // A field inside the editor (a card's URL input) has its own text; the bar would format the
  // editor selection behind it.
  const fieldInEditor = (): boolean => document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement)
  const refreshBar = (): void => {
    const inBar = bar?.host.contains(document.activeElement) ?? false
    const state = formatBarState(core.editor)
    if (core.gate.active || !state.visible || fieldInEditor() || !(inBar || root.contains(document.activeElement))) return closeBar()
    let range = bar?.range
    if (!inBar) {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return closeBar()
      range = selection.getRangeAt(0).cloneRange()
    }
    barActive = state.active
    if (bar) {
      bar.range = range!
      for (const listener of [...barListeners]) listener(barActive)
    } else {
      const host = document.createElement('div')
      host.style.position = 'absolute'
      host.style.zIndex = '5'
      host.addEventListener('focusout', onBarFocusOut)
      wrapper.append(host)
      const component = mount(FormatBar, {
        target: host,
        props: {
          subscribe: (listener) => {
            barListeners.add(listener)
            listener(barActive)
            return () => barListeners.delete(listener)
          },
          onformat: (format) => toggleFormat(core.editor, core.gate, format),
          onlink: (url) => applyLink(core.editor, core.gate, url),
          onunlink: () => removeLink(core.editor, core.gate),
          onfocuseditor: focusEditor,
        },
      })
      // The link field is wider than the buttons.
      const resize = new ResizeObserver(placeBar)
      resize.observe(host)
      bar = { host, component, range: range!, resize }
    }
    placeBar()
  }
  // Focus moving between the editor and the bar keeps it; anywhere else closes it.
  const onBarFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget
    if (next instanceof Node && (root.contains(next) || bar?.host.contains(next))) return
    closeBar()
  }
  const stopBarUpdates = core.editor.registerUpdateListener(refreshBar)
  const stopBarEditable = core.editor.registerEditableListener(refreshBar)
  root.addEventListener('focusin', refreshBar)
  root.addEventListener('focusout', onBarFocusOut)
  root.addEventListener('compositionstart', refreshBar)
  root.addEventListener('compositionend', refreshBar)
  root.addEventListener('scroll', placeBar)
  window.addEventListener('resize', placeBar)

  // The table actions button sits at the top-right corner of the table's scroll wrapper, in
  // the editor's wrapper, so it stays put while the table scrolls sideways. It is mounted only
  // while the caret is in a table cell, so the menu starts closed each time.
  let tableButton: { host: HTMLElement; component: Record<string, unknown>; key: NodeKey } | null = null
  const placeTableButton = (): void => {
    if (!tableButton) return
    // The node's element is the scroll wrapper, whose width is what the user sees.
    const scroller = core.editor.getElementByKey(tableButton.key)
    const table = scroller?.querySelector('table')
    if (!scroller || !table) return
    const box = scroller.getBoundingClientRect()
    const area = root.getBoundingClientRect()
    const frame = wrapper.getBoundingClientRect()
    tableButton.host.hidden = box.bottom < area.top || box.top > area.bottom
    if (tableButton.host.hidden) return
    const { offsetWidth: width, offsetHeight: height } = tableButton.host
    // Above the table; a table taller than the view keeps the button at the top edge.
    const top = Math.max(box.top - height - TABLE_BUTTON_GAP, area.top)
    tableButton.host.style.top = `${top - frame.top}px`
    tableButton.host.style.left = `${Math.max(0, Math.min(box.left + table.offsetWidth, box.right) - frame.left - width)}px`
  }
  const closeTableButton = (): void => {
    if (!tableButton) return
    // Cleared first: removing the focused button fires `focusout`, which closes again.
    const closing = tableButton
    tableButton = null
    void unmount(closing.component)
    closing.host.remove()
  }
  const refreshTableButton = (): void => {
    const key = core.editor.isEditable() && !core.gate.active ? tableAtCaret(core.editor) : null
    const focused = root.contains(document.activeElement) || (tableButton?.host.contains(document.activeElement) ?? false)
    if (key === null || !focused || fieldInEditor()) return closeTableButton()
    if (tableButton?.key !== key) {
      closeTableButton()
      const host = document.createElement('div')
      host.style.position = 'absolute'
      host.style.zIndex = '5'
      host.addEventListener('focusout', onTableButtonFocusOut)
      wrapper.append(host)
      const component = mount(TableActions, {
        target: host,
        props: {
          onaction: (action) => TABLE_ACTIONS[action](core.editor, core.gate),
          onfocuseditor: focusEditor,
        },
      })
      tableButton = { host, component, key }
    }
    placeTableButton()
  }
  const onTableButtonFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget
    if (next instanceof Node && (root.contains(next) || tableButton?.host.contains(next))) return
    closeTableButton()
  }
  const stopTableUpdates = core.editor.registerUpdateListener(refreshTableButton)
  const stopTableEditable = core.editor.registerEditableListener(refreshTableButton)
  root.addEventListener('focusin', refreshTableButton)
  root.addEventListener('focusout', onTableButtonFocusOut)
  root.addEventListener('compositionstart', refreshTableButton)
  root.addEventListener('compositionend', refreshTableButton)
  root.addEventListener('scroll', placeTableButton)
  window.addEventListener('resize', placeTableButton)

  // The emoji menu opens below an open `:name` and stays while the caret is in it. It is
  // mounted only while shown. The editor keeps the focus, so the keys come in as editor
  // commands, registered only while the menu is open.
  let emojiMenu: {
    host: HTMLElement
    component: Record<string, unknown>
    items: readonly EmojiEntry[]
    active: number
    queryLength: number
    stopKeys: () => void
  } | null = null
  const emojiListeners = new Set<(state: EmojiMenuState) => void>()
  // The shortcode whose menu the user closed with Esc; it stays closed until the caret leaves it.
  let dismissedEmoji: string | null = null
  let destroyed = false
  const publishEmoji = (): void => {
    if (!emojiMenu) return
    const state = { items: emojiMenu.items, active: emojiMenu.active }
    for (const listener of [...emojiListeners]) listener(state)
  }
  const placeEmoji = (): void => {
    if (!emojiMenu) return
    const selection = window.getSelection()
    const node = selection?.anchorNode
    if (!selection || selection.rangeCount === 0 || !node || !root.contains(node)) return
    // The range over `:query` has a rect even where a collapsed caret has none.
    const range = document.createRange()
    const length = emojiMenu.queryLength + 1
    if (node.nodeType === Node.TEXT_NODE && selection.anchorOffset >= length) {
      range.setStart(node, selection.anchorOffset - length)
      range.setEnd(node, selection.anchorOffset)
    } else {
      range.setStart(node, selection.anchorOffset)
      range.collapse(true)
    }
    const rects = range.getClientRects()
    const line = rects[rects.length - 1] ?? range.getBoundingClientRect()
    const area = root.getBoundingClientRect()
    const frame = wrapper.getBoundingClientRect()
    emojiMenu.host.hidden = line.bottom < area.top || line.top > area.bottom
    if (emojiMenu.host.hidden) return
    const { offsetWidth: width, offsetHeight: height } = emojiMenu.host
    // The on-screen keyboard shrinks the visual viewport, not the layout one.
    const viewport = window.visualViewport
    const bottom = Math.min(area.bottom, viewport ? viewport.offsetTop + viewport.height : innerHeight)
    const below = line.bottom + EMOJI_GAP
    const above = line.top - height - EMOJI_GAP
    const top = below + height > bottom && above >= area.top ? above : below
    emojiMenu.host.style.top = `${top - frame.top}px`
    emojiMenu.host.style.left = `${Math.max(0, Math.min(line.left - frame.left, frame.width - width))}px`
  }
  const closeEmoji = (): void => {
    if (!emojiMenu) return
    // Cleared first, as with the other popups.
    const closing = emojiMenu
    emojiMenu = null
    closing.stopKeys()
    document.removeEventListener('keydown', onEmojiEscape, true)
    void unmount(closing.component)
    closing.host.remove()
  }
  const moveEmoji = (delta: number): void => {
    if (!emojiMenu) return
    emojiMenu.active = (emojiMenu.active + delta + emojiMenu.items.length) % emojiMenu.items.length
    publishEmoji()
  }
  const pickEmojiEntry = (entry: EmojiEntry): void => {
    pickEmoji(core.editor, core.gate, entry.emoji)
    closeEmoji()
  }
  // In the capture phase, as in `TableActions`: Lexical would blur the editor on Esc, and the
  // note's dialog would close unless its default is prevented.
  const onEmojiEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !emojiMenu) return
    event.preventDefault()
    event.stopPropagation()
    dismissedEmoji = shortcodeQuery(core.editor)?.id ?? null
    closeEmoji()
  }
  // A key with a modifier is the editor's own (Shift-Enter, Alt-Arrow, ...).
  const emojiKey = (action: () => void) => (event: KeyboardEvent | null): boolean => {
    if (!emojiMenu || event?.shiftKey || event?.ctrlKey || event?.metaKey || event?.altKey) return false
    event?.preventDefault()
    action()
    return true
  }
  const pickActiveEmoji = (): void => {
    if (emojiMenu) pickEmojiEntry(emojiMenu.items[emojiMenu.active]!)
  }
  const refreshEmoji = (): void => {
    if (destroyed) return
    const query = root.contains(document.activeElement) && !core.gate.active ? shortcodeQuery(core.editor) : null
    if (!query || query.id === dismissedEmoji) {
      if (!query) dismissedEmoji = null
      return closeEmoji()
    }
    const index = loadedEmojiIndex()
    if (!index) {
      void loadEmojiIndex().then((loaded) => loaded && refreshEmoji())
      return
    }
    const items = matchEmoji(index, query.query, EMOJI_LIMIT)
    if (items.length === 0) return closeEmoji()
    if (!emojiMenu) {
      const host = document.createElement('div')
      host.style.position = 'absolute'
      host.style.zIndex = '5'
      wrapper.append(host)
      const component = mount(EmojiMenu, {
        target: host,
        props: {
          subscribe: (listener) => {
            emojiListeners.add(listener)
            listener({ items: emojiMenu?.items ?? [], active: emojiMenu?.active ?? 0 })
            return () => emojiListeners.delete(listener)
          },
          onpick: pickEmojiEntry,
          onhover: (active) => {
            if (!emojiMenu) return
            emojiMenu.active = active
            publishEmoji()
          },
        },
      })
      emojiMenu = {
        host,
        component,
        items,
        active: 0,
        queryLength: query.query.length,
        stopKeys: mergeRegister(
          // Critical: the table extension takes arrows and Tab at high priority in a cell.
          core.editor.registerCommand(KEY_ARROW_DOWN_COMMAND, emojiKey(() => moveEmoji(1)), COMMAND_PRIORITY_CRITICAL),
          core.editor.registerCommand(KEY_ARROW_UP_COMMAND, emojiKey(() => moveEmoji(-1)), COMMAND_PRIORITY_CRITICAL),
          core.editor.registerCommand(KEY_ENTER_COMMAND, emojiKey(pickActiveEmoji), COMMAND_PRIORITY_CRITICAL),
          core.editor.registerCommand(KEY_TAB_COMMAND, emojiKey(pickActiveEmoji), COMMAND_PRIORITY_CRITICAL),
        ),
      }
      document.addEventListener('keydown', onEmojiEscape, true)
    } else {
      // The same suggestions keep the highlight where the user moved it.
      const same = items.length === emojiMenu.items.length && items.every((item, i) => item.name === emojiMenu!.items[i]!.name)
      emojiMenu.items = items
      emojiMenu.queryLength = query.query.length
      if (!same) emojiMenu.active = 0
    }
    publishEmoji()
    placeEmoji()
  }
  const stopEmojiUpdates = core.editor.registerUpdateListener(refreshEmoji)
  const stopEmojiEditable = core.editor.registerEditableListener(refreshEmoji)
  root.addEventListener('focusout', closeEmoji)
  root.addEventListener('compositionstart', refreshEmoji)
  root.addEventListener('compositionend', refreshEmoji)
  root.addEventListener('scroll', placeEmoji)
  window.addEventListener('resize', placeEmoji)
  window.visualViewport?.addEventListener('resize', placeEmoji)

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
      stopBarUpdates()
      stopBarEditable()
      closeBar()
      root.removeEventListener('focusin', refreshBar)
      root.removeEventListener('focusout', onBarFocusOut)
      root.removeEventListener('compositionstart', refreshBar)
      root.removeEventListener('compositionend', refreshBar)
      root.removeEventListener('scroll', placeBar)
      window.removeEventListener('resize', placeBar)
      stopTableUpdates()
      stopTableEditable()
      closeTableButton()
      root.removeEventListener('focusin', refreshTableButton)
      root.removeEventListener('focusout', onTableButtonFocusOut)
      root.removeEventListener('compositionstart', refreshTableButton)
      root.removeEventListener('compositionend', refreshTableButton)
      root.removeEventListener('scroll', placeTableButton)
      window.removeEventListener('resize', placeTableButton)
      destroyed = true
      stopEmojiUpdates()
      stopEmojiEditable()
      closeEmoji()
      root.removeEventListener('focusout', closeEmoji)
      root.removeEventListener('compositionstart', refreshEmoji)
      root.removeEventListener('compositionend', refreshEmoji)
      root.removeEventListener('scroll', placeEmoji)
      window.removeEventListener('resize', placeEmoji)
      window.visualViewport?.removeEventListener('resize', placeEmoji)
      stopEditable()
      stopDecorators()
      root.removeEventListener('compositionstart', begin)
      root.removeEventListener('compositionend', end)
      core.editor.setRootElement(null)
      core.destroy()
    },
  }
}
