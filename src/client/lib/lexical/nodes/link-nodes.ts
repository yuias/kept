import { AutoLinkNode, LinkNode } from '@lexical/link'
import { isHTMLAnchorElement, type EditorConfig } from 'lexical'
import { linkHref } from '../../link-href'

/**
 * Stock link nodes always render `href = sanitizeUrl(url)`, which lets targets the
 * app does not open (`ftp:`, relative paths, ...) show up as anchors. These
 * subclasses write `linkHref(url)` instead and leave other targets without `href`.
 */
function writeHref(anchor: HTMLElement, url: string): void {
  // An unlinked auto link renders as a span, which never carries an href.
  if (!isHTMLAnchorElement(anchor)) return
  const href = linkHref(url)
  if (href === null) anchor.removeAttribute('href')
  else anchor.setAttribute('href', href)
}

export class KeptLinkNode extends LinkNode {
  $config() {
    return this.config('kept-link', { extends: LinkNode })
  }

  updateLinkDOM(prevNode: this | null, anchor: HTMLElement, config: EditorConfig): void {
    super.updateLinkDOM(prevNode, anchor, config)
    writeHref(anchor, this.__url)
  }
}

export class KeptAutoLinkNode extends AutoLinkNode {
  $config() {
    return this.config('kept-autolink', { extends: AutoLinkNode })
  }

  updateLinkDOM(prevNode: this | null, anchor: HTMLElement, config: EditorConfig): void {
    super.updateLinkDOM(prevNode, anchor, config)
    writeHref(anchor, this.__url)
  }
}

// The replacement classes are registered too: `withKlass` alone leaves them unknown to the
// editor, which then rejects their transforms and their JSON type.
export const linkNodeReplacements = [
  KeptLinkNode,
  KeptAutoLinkNode,
  {
    replace: LinkNode,
    with: (node: LinkNode) => new KeptLinkNode(node.getURL(), { rel: node.getRel(), target: node.getTarget(), title: node.getTitle() }),
    withKlass: KeptLinkNode,
  },
  {
    replace: AutoLinkNode,
    with: (node: AutoLinkNode) =>
      new KeptAutoLinkNode(node.getURL(), {
        rel: node.getRel(),
        target: node.getTarget(),
        title: node.getTitle(),
        isUnlinked: node.getIsUnlinked(),
      }),
    withKlass: KeptAutoLinkNode,
  },
]
