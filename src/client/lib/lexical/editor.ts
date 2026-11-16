import { createEditorCore, type EditorCore, type EditorCoreOptions } from './core'

export interface RichEditorOptions extends EditorCoreOptions {
  root: HTMLElement
}

export type RichEditorHandle = Omit<EditorCore, 'editor' | 'gate'>

export function createRichEditor({ root, ...options }: RichEditorOptions): RichEditorHandle {
  const core = createEditorCore(options)
  core.editor.setRootElement(root)
  // Lexical never writes `contenteditable`, so an uneditable root would still take input.
  const syncEditable = (editable: boolean): void => {
    root.contentEditable = String(editable)
  }
  syncEditable(core.editor.isEditable())
  const stopEditable = core.editor.registerEditableListener(syncEditable)
  return {
    insertText: (s) => core.insertText(s),
    replaceText: (token, s) => core.replaceText(token, s),
    focus: () => core.focus(),
    setValue: (markdown) => core.setValue(markdown),
    setReadOnly: (readOnly, tasksToggleable) => core.setReadOnly(readOnly, tasksToggleable),
    destroy() {
      stopEditable()
      core.editor.setRootElement(null)
      core.destroy()
    },
  }
}
