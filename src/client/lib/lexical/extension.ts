import { CodeNode } from '@lexical/code-core'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table'
import { HorizontalRuleNode } from '@lexical/extension'
import { defineExtension } from 'lexical'
import { CardNode } from './nodes/card-node'
import { ImageNode } from './nodes/image-node'

/** Node classes the markdown conversion needs; no DOM or React dependency, so it also runs headless. */
export const MarkdownNodesExtension = defineExtension({
  name: 'kept/markdown-nodes',
  nodes: () => [
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
    LinkNode,
    AutoLinkNode,
    CodeNode,
    HorizontalRuleNode,
    TableNode,
    TableRowNode,
    TableCellNode,
    ImageNode,
    CardNode,
  ],
})
