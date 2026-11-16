import { mount, unmount } from 'svelte'
import PasteChoice from '../../components/editor/PasteChoice.svelte'
import { createCardOps } from './cards'
import { createEditorCore, type EditorCore, type EditorCoreOptions } from './core'
import { mountDecorators } from './decorators'

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
    setReadOnly: (readOnly, tasksToggleable) => core.setReadOnly(readOnly, tasksToggleable),
    destroy() {
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
