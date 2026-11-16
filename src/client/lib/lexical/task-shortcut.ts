import { $isListItemNode, $isListNode, type ListNode } from '@lexical/list'
import {
  $addUpdateTag,
  $copyNode,
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  COLLABORATION_TAG,
  HISTORIC_TAG,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
} from 'lexical'
import { EXTERNAL_TAG } from './sync'

/**
 * `- [ ] ` is typed as a bullet first (`- ` converts at once), so the stock check
 * list shortcut, which only reads a paragraph, never sees the box. This turns a
 * bullet item into a check item when `[ ] ` or `[x] ` is typed at its start.
 * It runs from the typing itself, not as a node transform: a bullet item that
 * starts with an escaped `[ ]` must stay text when a note is loaded.
 */
export function registerTaskShortcut(editor: LexicalEditor): () => void {
  return editor.registerUpdateListener(({ tags, editorState, prevEditorState }) => {
    if (tags.has(COLLABORATION_TAG) || tags.has(HISTORIC_TAG) || tags.has(EXTERNAL_TAG) || editor.isComposing()) return
    const selection = editorState.read($getSelection)
    const previous = prevEditorState.read($getSelection)
    if (!$isRangeSelection(selection) || !$isRangeSelection(previous) || !selection.isCollapsed()) return
    const { key, offset } = selection.anchor
    // Only the character that completes the box counts, not a deletion or a caret jump.
    if (selection.anchor.type !== 'text' || previous.anchor.key !== key || previous.anchor.offset !== offset - 1) return

    editor.update(() => {
      const node = editorState._nodeMap.get(key)
      const text = $isTextNode(node) ? node.getLatest() : null
      const item = text?.getParent()
      const list = item?.getParent()
      if (!text || !$isListItemNode(item) || !$isListNode(list) || list.getListType() !== 'bullet' || text.getPreviousSibling()) return
      const box = /^\[([ x])?\] $/i.exec(text.getTextContent().slice(0, offset))
      if (!box) return

      const before = item.getPreviousSiblings()
      const after = item.getNextSiblings()
      // A nested list sits in a wrapper item that holds nothing else, so only a root list is split.
      if ((before.length > 0 || after.length > 0) && !$isRootNode(list.getParent())) return

      text.spliceText(0, offset, '')
      item.setChecked(/^x$/i.test(box[1] ?? ''))
      if (before.length === 0 && after.length === 0) {
        list.setListType('check')
      } else {
        // The other items stay bullets. Adjacent lists of one type merge by themselves.
        const checked = $copyNode(list).setListType('check')
        if (before.length === 0) list.insertBefore(checked)
        else list.insertAfter(checked)
        checked.append(item)
        if (after.length > 0) {
          const rest: ListNode = $copyNode(list)
          checked.insertAfter(rest)
          rest.append(...after)
        }
      }
      $addUpdateTag(HISTORY_PUSH_TAG)
    })
  })
}
