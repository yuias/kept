import { createCardOps } from './cards'
import { createEditorCore, type EditorCore, type EditorCoreOptions } from './core'
import { mountDecorators } from './decorators'

export interface RichEditorOptions extends EditorCoreOptions {
  root: HTMLElement
}

export type RichEditorHandle = Omit<EditorCore, 'editor' | 'gate'>

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
  return {
    insertText: (s) => core.insertText(s),
    replaceText: (token, s) => core.replaceText(token, s),
    focus: () => core.focus(),
    setValue: (markdown) => core.setValue(markdown),
    setReadOnly: (readOnly, tasksToggleable) => core.setReadOnly(readOnly, tasksToggleable),
    destroy() {
      stopEditable()
      stopDecorators()
      root.removeEventListener('compositionstart', begin)
      root.removeEventListener('compositionend', end)
      core.editor.setRootElement(null)
      core.destroy()
    },
  }
}
