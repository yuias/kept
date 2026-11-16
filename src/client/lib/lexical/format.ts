import { $isCodeNode } from '@lexical/code-core'
import { $isAutoLinkNode, $isLinkNode } from '@lexical/link'
import { $findMatchingParent, mergeRegister } from '@lexical/utils'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  IS_APPLE,
  isModifierMatch,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type RangeSelection,
  type TextFormatType,
  type TextNode,
} from 'lexical'

/** The formats markdown can store; every other text format is refused. */
const FORMATS = ['bold', 'italic', 'strikethrough', 'code'] as const
type InlineFormat = (typeof FORMATS)[number]

export interface FormatBarState {
  visible: boolean
  active: Set<InlineFormat | 'link'>
}

/**
 * Mod-b and Mod-i are bound by Lexical itself. Mod-e and Mod-Shift-x have no
 * Lexical binding, so they are added here. Formats markdown cannot store
 * (underline, highlight, sub/superscript, case) are swallowed instead of being
 * applied and then lost on export.
 */
export function registerFormatKeys(editor: LexicalEditor): () => void {
  const mod = { metaKey: IS_APPLE, ctrlKey: !IS_APPLE, altKey: false }
  return mergeRegister(
    editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        const key = event.key?.toLowerCase()
        const format =
          key === 'e' && isModifierMatch(event, { ...mod, shiftKey: false })
            ? 'code'
            : key === 'x' && isModifierMatch(event, { ...mod, shiftKey: true })
              ? 'strikethrough'
              : null
        if (format === null) return false
        event.preventDefault()
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
        return true
      },
      COMMAND_PRIORITY_HIGH,
    ),
    // Text in a code block carries no format in markdown either, so it is not applied there.
    editor.registerCommand(
      FORMAT_TEXT_COMMAND,
      (format) => {
        const selection = $getSelection()
        return !(FORMATS as readonly TextFormatType[]).includes(format) || ($isRangeSelection(selection) && $inCodeBlock(selection))
      },
      COMMAND_PRIORITY_HIGH,
    ),
  )
}

// Edge text nodes of a range that contribute no characters (a selection that
// starts at the end of one node or ends at the start of another) are not selected.
function $selectedTextNodes(selection: RangeSelection): TextNode[] {
  const [start, end] = selection.isBackward() ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus]
  return selection.getNodes().filter(
    (node): node is TextNode =>
      $isTextNode(node) &&
      !(start.type === 'text' && node.is(start.getNode()) && !node.is(end.getNode()) && start.offset === node.getTextContentSize()) &&
      !(end.type === 'text' && node.is(end.getNode()) && !node.is(start.getNode()) && end.offset === 0),
  )
}

const $inCodeBlock = (selection: RangeSelection): boolean =>
  [selection.anchor, selection.focus].some((point) => $findMatchingParent(point.getNode(), $isCodeNode) !== null)

/**
 * What the floating format bar shows: visible for a non-collapsed selection
 * outside code blocks, with the formats that every selected text node has.
 */
export function formatBarState(editor: LexicalEditor): FormatBarState {
  return editor.read(() => {
    const hidden: FormatBarState = { visible: false, active: new Set() }
    const selection = $getSelection()
    if (editor.isComposing() || !editor.isEditable() || !$isRangeSelection(selection) || selection.isCollapsed()) return hidden
    if ($inCodeBlock(selection)) return hidden

    const nodes = $selectedTextNodes(selection)
    const active = new Set<InlineFormat | 'link'>(nodes.length === 0 ? [] : FORMATS.filter((format) => nodes.every((node) => node.hasFormat(format))))
    // An auto link is not an editable link: it exports bare.
    if (nodes.length > 0 && nodes.every((node) => $findMatchingParent(node, (parent) => $isLinkNode(parent) && !$isAutoLinkNode(parent)) !== null)) {
      active.add('link')
    }
    return { visible: true, active }
  })
}
