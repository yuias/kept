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
import { $isListItemNode, CheckListExtension, ListExtension } from '@lexical/list'
import { registerMarkdownShortcuts, type Transformer } from '@lexical/markdown'
import { $isHeadingNode, RichTextExtension } from '@lexical/rich-text'
import { TableExtension } from '@lexical/table'
import { $getNearestBlockElementAncestorOrThrow, mergeRegister } from '@lexical/utils'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  HISTORY_MERGE_TAG,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  PASTE_COMMAND,
  TextNode,
  type LexicalEditor,
  type LexicalEditorWithDispose,
  type UpdateListener,
} from 'lexical'
import { registerBlockKeys } from './blocks'
import { CompositionGate } from './composition'
import { registerEmojiShortcut } from './emoji'
import { classifyRoundTrip } from './fidelity'
import { MarkdownNodesExtension } from './extension'
import { registerFormatKeys } from './format'
import { $exportMarkdown, $rootSeams, TRANSFORMERS } from './markdown'
import { linkNodeReplacements } from './nodes/link-nodes'
import { $pasteMarkdown, createPlaceholderOps } from './placeholders'
import { $replaceDocument, applyExternalValue, EXTERNAL_TAG } from './sync'
import { registerTaskShortcut } from './task-shortcut'
import { theme } from './theme'
import { createUrlPaste, type UrlPasteController } from './url-paste'

export { EXTERNAL_TAG }

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
  gate: CompositionGate
  urlPaste: UrlPasteController
  setValue(markdown: string): void
  setReadOnly(readOnly: boolean, tasksToggleable: boolean): void
  destroy(): void
}

/** Everything the editor needs apart from per-instance state; headless-safe (no DOM, no Svelte). */
export const RichEditorExtension = defineExtension({
  name: 'kept/rich-editor',
  theme,
  // Replacements only here: markdown conversion without a DOM keeps the stock classes.
  nodes: () => linkNodeReplacements,
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
    mergeRegister(
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
      // Lexical skips shortcuts while an IME composition is active.
      registerMarkdownShortcuts(ignoreExternalUpdates(editor), TRANSFORMERS),
      registerTaskShortcut(editor),
      registerEmojiShortcut(editor),
      registerFormatKeys(editor),
      // A line break in a heading or list item exports as a soft break that reloads
      // as a separate root paragraph, so it splits the block like Enter does. Some
      // Android keyboards report plain Enter as a line break.
      editor.registerCommand(
        INSERT_LINE_BREAK_COMMAND,
        () => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return false
          // Both ends: a backward range merges into the block of its focus.
          const inBlock = [selection.anchor, selection.focus].some((point) => {
            const block = $getNearestBlockElementAncestorOrThrow(point.getNode())
            return $isHeadingNode(block) || $isListItemNode(block)
          })
          return inBlock && editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined)
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ),
})

/**
 * Lexical's shortcut listener skips collaboration and history updates but not
 * ours. After an external value the restored caret can sit right behind text such
 * as `# `, which would turn into a heading. Update listeners registered through
 * the returned editor do not see updates tagged `EXTERNAL_TAG`.
 */
function ignoreExternalUpdates(editor: LexicalEditor): LexicalEditor {
  return new Proxy(editor, {
    get(target, property) {
      if (property === 'registerUpdateListener') {
        return (listener: UpdateListener) =>
          target.registerUpdateListener((payload) => {
            if (!payload.tags.has(EXTERNAL_TAG)) listener(payload)
          })
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Calls `onChange` with the exported markdown after an update that changed it.
 * `state` holds the export of the loaded (or externally replaced) document, with
 * the seams recorded at that time; it moves to each new export that is emitted.
 * While `unsupported` is set the document is not one the editor can keep, so
 * nothing is emitted.
 */
function registerMarkdownChanges(
  editor: LexicalEditor,
  transformers: Transformer[],
  state: { baseline: string; seams: ReadonlySet<string>; unsupported: boolean; edits: number },
  onChange: (markdown: string) => void,
): () => void {
  return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
    if ((dirtyElements.size === 0 && dirtyLeaves.size === 0) || tags.has(EXTERNAL_TAG) || state.unsupported) return
    const markdown = editorState.read(() => $exportMarkdown(transformers, state.seams))
    if (markdown === state.baseline) return
    state.baseline = markdown
    state.edits += 1
    onChange(markdown)
  })
}

export function createEditorCore(options: EditorCoreOptions, transformers: Transformer[] = TRANSFORMERS): EditorCore {
  // `edits` counts emitted user changes, so a queued external value can tell it is stale.
  const state = { baseline: '', seams: new Set<string>() as ReadonlySet<string>, unsupported: false, edits: 0 }
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
      $initialEditorState: () => $replaceDocument(options.value, transformers),
    }),
  )
  editor.setEditable(!options.readOnly)

  // Seams are recorded in a read after the load commits, so node transforms have run.
  // The fidelity guard compares `source` with that same export. A note the editor
  // would store differently must stay out of the formatted editor, so it is
  // reported and the editor never emits for it.
  const record = (source: string): void => {
    state.seams = editor.read($rootSeams)
    state.baseline = editor.read(() => $exportMarkdown(transformers, state.seams))
    state.unsupported = classifyRoundTrip(source, state.baseline) === 'render-different'
    if (state.unsupported) options.onUnsupported()
  }
  record(options.value)

  // Empty means the export is '', so the placeholder shows; it follows `baseline`,
  // which every content update and `setValue` keeps current.
  let empty: boolean | null = null
  const syncEmpty = (): void => {
    if (empty === (state.baseline === '')) return
    empty = state.baseline === ''
    options.onEmptyChange(empty)
  }
  syncEmpty()
  const gate = new CompositionGate(editor)
  const urlPaste = createUrlPaste(editor, gate)
  const unregister = [
    registerMarkdownChanges(editor, transformers, state, options.onChange),
    registerBlockKeys(editor, gate),
    // Before Lexical's own paste handling: the app takes image files itself and
    // prevents the default, which stops Lexical from pasting the clipboard text too.
    editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        // Lexical also dispatches this for an `insertFromPaste` input event, which has no
        // `clipboardData`; the callback only reads it, so it sees no files then.
        options.onPaste(event as ClipboardEvent)
        // A pasted image wins: its clipboard may carry the file name as text too.
        if (event.defaultPrevented) return true
        // Then a lone URL, then plain text as markdown; anything else is Lexical's.
        const clipboardEvent = event as ClipboardEvent
        return (
          urlPaste.paste(clipboardEvent) ||
          (!gate.active && editor.isEditable() && $pasteMarkdown(clipboardEvent, transformers))
        )
      },
      COMMAND_PRIORITY_HIGH,
    ),
    // After the change listener, so `baseline` is already current.
    editor.registerUpdateListener(({ tags }) => {
      if (!tags.has(EXTERNAL_TAG)) syncEmpty()
    }),
  ]

  const placeholders = createPlaceholderOps(editor, gate, transformers)

  return {
    editor,
    gate,
    urlPaste,
    setValue(markdown) {
      applyExternalValue(editor, gate, markdown, {
        transformers,
        seams: () => state.seams,
        edits: () => state.edits,
        onReplaced(source) {
          record(source)
          syncEmpty()
        },
      })
    },
    setReadOnly(readOnly) {
      editor.setEditable(!readOnly)
    },
    insertText: placeholders.insertText,
    replaceText: placeholders.replaceText,
    focus() {
      editor.focus()
    },
    destroy() {
      try {
        // A replacement that waited out a composition must still reach `onChange`: the
        // note is saved from what the editor emitted, and the placeholder would stay in it.
        placeholders.flush()
      } finally {
        for (const off of unregister) off()
        urlPaste.destroy()
        gate.dispose()
        editor.dispose()
      }
    },
  }
}
