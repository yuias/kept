import {
  $create,
  $getDocument,
  type EditorConfig,
  DecoratorNode,
  type NodeKey,
  nodeSchema,
  nullable,
  stringValue,
  withField,
} from 'lexical'

export interface ImageDecoration {
  kind: 'image'
  src: string
  alt: string
}

const imageNodeSchema = nodeSchema<ImageNode>()({
  alt: withField(stringValue(), { field: '__alt' }),
  src: withField(stringValue(), { field: '__src' }),
  title: withField(nullable(stringValue(), { defaultAsNull: true }), { field: '__title' }),
})

/**
 * `![alt](src "title")` as written in the note. The fields keep the source
 * spelling as is, whatever the target is: whether an `<img>` may be rendered
 * for it is up to the view (`isLocalImageUrl`), so export stays byte-exact.
 * The upload placeholder `![uploading-<uuid>]()` is an image with an empty src.
 */
export class ImageNode extends DecoratorNode<ImageDecoration> {
  /** @internal */
  __src: string
  /** @internal */
  __alt: string
  /** @internal */
  __title: string | null

  $config() {
    return this.config('kept-image', { extends: DecoratorNode, inline: true, json: imageNodeSchema })
  }

  constructor(src = '', alt = '', title: string | null = null, key?: NodeKey) {
    super(key)
    this.__src = src
    this.__alt = alt
    this.__title = title
  }

  getSrc(): string {
    return this.getLatest().__src
  }

  setSrc(src: string): this {
    const self = this.getWritable()
    self.__src = src
    return self
  }

  getAlt(): string {
    return this.getLatest().__alt
  }

  setAlt(alt: string): this {
    const self = this.getWritable()
    self.__alt = alt
    return self
  }

  getTitle(): string | null {
    return this.getLatest().__title
  }

  setTitle(title: string | null): this {
    const self = this.getWritable()
    self.__title = title
    return self
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return $getDocument().createElement('span')
  }

  updateDOM(): false {
    return false
  }

  isInline(): true {
    return true
  }

  // Copying the node as plain text keeps the markdown, and the exporter reads this too.
  getTextContent(): string {
    const { __src: src, __alt: alt, __title: title } = this.getLatest()
    return `![${alt}](${src}${title === null ? '' : ` "${title}"`})`
  }

  decorate(): ImageDecoration {
    return { kind: 'image', src: this.getSrc(), alt: this.getAlt() }
  }
}

export function $createImageNode(src: string, alt: string, title: string | null = null): ImageNode {
  return $create(ImageNode).setSrc(src).setAlt(alt).setTitle(title)
}

export function $isImageNode(node: unknown): node is ImageNode {
  return node instanceof ImageNode
}
