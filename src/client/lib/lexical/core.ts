import { $isCodeNode, CodeExtension } from '@lexical/code-core'
import {
  buildEditorFromExtensions,
  configExtension,
  defineExtension,
  HorizontalRuleExtension,
  InitialStateExtension,
} from '@lexical/extension'
import { HistoryExtension } from '@lexical/history'
import {
  $isAutoLinkNode,
  AutoLinkExtension,
  autoLinkEmailMatcher,
  autoLinkUrlMatcher,
  LinkExtension,
} from '@lexical/link'
import { CheckListExtension, ListExtension } from '@lexical/list'
import type { Transformer } from '@lexical/markdown'
import { RichTextExtension } from '@lexical/rich-text'
import { TableExtension } from '@lexical/table'
import {
  $createParagraphNode,
  $getRoot,
  $isTextNode,
  HISTORY_MERGE_TAG,
  TextNode,
  type LexicalEditor,
  type LexicalEditorWithDispose,
} from 'lexical'
import { MarkdownNodesExtension } from './extension'
import { $exportMarkdown, $importMarkdown, $rootSeams, TRANSFORMERS } from './markdown'

/** Marks updates the app makes itself (initial load, external value); they never reach `onChange`. */
export const EXTERNAL_TAG = 'kept-external'

export interface BodyEditor {
  insertText(s: string): void
  replaceText(token: string, s: string): boolean
  focus(): void
}

export interface EditorCoreOptions {
  value: string
  readOnly: boolean
  tasksToggleable: boolean
  onChange: (markdown: string) => void
  onPaste: (event: ClipboardEvent) => void
  onUnsupported: () => void
  onEmptyChange: (empty: boolean) => void
}

export interface EditorCore extends BodyEditor {
  editor: LexicalEditor
  setValue(markdown: string): void
  setReadOnly(readOnly: boolean, tasksToggleable: boolean): void
  destroy(): void
}

/** Everything the editor needs apart from per-instance state; headless-safe (no DOM, no Svelte). */
export const RichEditorExtension = defineExtension({
  name: 'kept/rich-editor',
  dependencies: [
    MarkdownNodesExtension,
    RichTextExtension,
    ListExtension,
    CheckListExtension,
    configExtension(TableExtension, { hasCellMerge: false }),
    HistoryExtension,
    LinkExtension,
    // Bare URLs stay clickable and still export bare. The default matcher list is empty.
    configExtension(AutoLinkExtension, {
      matchers: [autoLinkUrlMatcher, autoLinkEmailMatcher],
      excludeParents: [$isCodeNode],
    }),
    HorizontalRuleExtension,
    CodeExtension,
  ],
  register: (editor) =>
    // An auto link around inline code would render as a link inside code. Unlinking
    // (rather than unwrapping) keeps the auto-link transform from re-creating it.
    // Registered on TextNode because a format change dirties only the text node,
    // and element transforms skip elements that are dirty only through a child.
    editor.registerNodeTransform(TextNode, (node) => {
      const parent = node.getParent()
      if (
        $isAutoLinkNode(parent) &&
        !parent.getIsUnlinked() &&
        parent.getChildren().every((child) => $isTextNode(child) && child.hasFormat('code'))
      ) {
        parent.setIsUnlinked(true)
      }
    }),
})

/**
 * Calls `onChange` with the exported markdown after an update that changed it.
 * `state` holds the export of the loaded (or externally replaced) document, with
 * the seams recorded at that time; it moves to each new export that is emitted.
 */
function registerMarkdownChanges(
  editor: LexicalEditor,
  transformers: Transformer[],
  state: { baseline: string; seams: ReadonlySet<string> },
  onChange: (markdown: string) => void,
): () => void {
  return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
    if ((dirtyElements.size === 0 && dirtyLeaves.size === 0) || tags.has(EXTERNAL_TAG)) return
    const markdown = editorState.read(() => $exportMarkdown(transformers, state.seams))
    if (markdown === state.baseline) return
    state.baseline = markdown
    onChange(markdown)
  })
}

export function createEditorCore(options: EditorCoreOptions, transformers: Transformer[] = TRANSFORMERS): EditorCore {
  const state = { baseline: '', seams: new Set<string>() as ReadonlySet<string> }
  const editor: LexicalEditorWithDispose = buildEditorFromExtensions(
    defineExtension({
      name: 'kept/editor-core',
      dependencies: [
        RichEditorExtension,
        // Discrete, so the load is committed before the listeners below exist.
        configExtension(InitialStateExtension, { updateOptions: { tag: [HISTORY_MERGE_TAG, EXTERNAL_TAG], discrete: true } }),
      ],
      // A failed load must reach the caller: a rolled-back load would leave an
      // empty, editable document that the first keystroke saves over the note.
      onError: (error) => {
        throw error
      },
      $initialEditorState: () => {
        $importMarkdown(options.value, transformers)
        if ($getRoot().isEmpty()) $getRoot().append($createParagraphNode())
      },
    }),
  )
  editor.setEditable(!options.readOnly)

  // Seams are recorded in a read after the load commits, so node transforms have run.
  const record = (): void => {
    state.seams = editor.read($rootSeams)
    state.baseline = editor.read(() => $exportMarkdown(transformers, state.seams))
  }
  record()

  // Empty means the export is '', as with CodeMirror's placeholder; it follows `baseline`,
  // which every content update and `setValue` keeps current.
  let empty: boolean | null = null
  const syncEmpty = (): void => {
    if (empty === (state.baseline === '')) return
    empty = state.baseline === ''
    options.onEmptyChange(empty)
  }
  syncEmpty()
  const unregister = [
    registerMarkdownChanges(editor, transformers, state, options.onChange),
    // After the change listener, so `baseline` is already current.
    editor.registerUpdateListener(({ tags }) => {
      if (!tags.has(EXTERNAL_TAG)) syncEmpty()
    }),
  ]

  return {
    editor,
    setValue(markdown) {
      editor.update(
        () => {
          $importMarkdown(markdown, transformers)
          if ($getRoot().isEmpty()) $getRoot().append($createParagraphNode())
        },
        { tag: [HISTORY_MERGE_TAG, EXTERNAL_TAG], discrete: true },
      )
      record()
      syncEmpty()
    },
    setReadOnly(readOnly) {
      editor.setEditable(!readOnly)
    },
    insertText() {},
    replaceText: () => false,
    focus() {
      editor.focus()
    },
    destroy() {
      for (const off of unregister) off()
      editor.dispose()
    },
  }
}
