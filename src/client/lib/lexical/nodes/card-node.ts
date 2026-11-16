import {
  $create,
  $getDocument,
  type EditorConfig,
  DecoratorNode,
  type NodeKey,
  nodeSchema,
  stringValue,
  withField,
} from 'lexical'
import { cardMarkup } from '../../../../shared/link-card'

export interface CardDecoration {
  kind: 'card'
  url: string
}

const cardNodeSchema = nodeSchema<CardNode>()({
  url: withField(stringValue(), { field: '__url' }),
})

/** A `@[card](url)` line, as a block that sits directly in the root. */
export class CardNode extends DecoratorNode<CardDecoration> {
  /** @internal */
  __url: string

  $config() {
    return this.config('kept-card', { extends: DecoratorNode, json: cardNodeSchema })
  }

  constructor(url = '', key?: NodeKey) {
    super(key)
    this.__url = url
  }

  getURL(): string {
    return this.getLatest().__url
  }

  setURL(url: string): this {
    const self = this.getWritable()
    self.__url = url
    return self
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return $getDocument().createElement('div')
  }

  updateDOM(): false {
    return false
  }

  isInline(): false {
    return false
  }

  // Copying the node as plain text keeps the markdown, and the exporter reads this too.
  getTextContent(): string {
    return cardMarkup(this.getURL())
  }

  decorate(): CardDecoration {
    return { kind: 'card', url: this.getURL() }
  }
}

export function $createCardNode(url: string): CardNode {
  return $create(CardNode).setURL(url)
}

export function $isCardNode(node: unknown): node is CardNode {
  return node instanceof CardNode
}
