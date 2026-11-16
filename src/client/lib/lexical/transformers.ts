import type { ElementTransformer, TextMatchTransformer } from '@lexical/markdown'
import { $isParagraphNode, $isTextNode, IS_CODE, ParagraphNode } from 'lexical'
import { escapeLineStart, type LineStartBlocks } from './escape'

// Thematic breaks and table rows are plain paragraphs until the RULE and TABLE
// transformers exist; escaping them now would change the bytes of notes that
// load and export unchanged. Switch each flag on together with its transformer.
const LINE_START_BLOCKS: LineStartBlocks = { thematicBreak: false, tableRow: false }

// Never matches: the transformer exists only to post-process what a paragraph
// exports, so a paragraph must not be imported through it.
const NEVER = /(?!)/

/** Escapes the lines of a root paragraph that would reload as another block. */
export const PARAGRAPH_LINE_START: ElementTransformer = {
  dependencies: [ParagraphNode],
  export: (node, exportChildren) => {
    if (!$isParagraphNode(node)) return null
    return exportChildren(node).split('\n').map((line) => escapeLineStart(line, LINE_START_BLOCKS)).join('\n')
  },
  regExp: NEVER,
  replace: () => false,
  type: 'element',
}

/**
 * Writes plain inline code. The stock export pads the content with a space on
 * both sides whenever it contains a backtick and fences it with a run longer
 * than any inside, which changes the bytes of `` ``a ` b`` ``. Here the fence is
 * the shortest run length the content does not contain (a longer run could
 * start a fenced block at the start of a line), and padding is only used where
 * CommonMark would otherwise drop or merge characters: a backtick at either
 * end, or whitespace at both ends of content that is not all whitespace.
 * Nodes that carry other formats still go through the stock export.
 */
export const CODE_SPAN: TextMatchTransformer = {
  dependencies: [],
  export: (node) => {
    if (!$isTextNode(node) || node.getFormat() !== IS_CODE) return null
    const content = node.getTextContent()
    const used = new Set((content.match(/`+/g) ?? []).map((run) => run.length))
    let length = 1
    while (used.has(length)) length++
    const fence = '`'.repeat(length)
    const padded = content === '' || /^`|`$/.test(content) || (/^\s/.test(content) && /\s$/.test(content) && /\S/.test(content))
    return padded ? `${fence} ${content} ${fence}` : fence + content + fence
  },
  regExp: NEVER,
  type: 'text-match',
}
