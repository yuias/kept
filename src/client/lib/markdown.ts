import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { highlightToHtml } from './highlight'

const marked = new Marked({ gfm: true, breaks: false, async: false })

/** Adds `target="_blank"` safely; DOMPurify keeps the rel we set here. */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
  }
})

export function renderMarkdown(source: string): string {
  const html = marked.parse(source) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
}

const LANGUAGE_CLASS = /^language-(.+)$/

/**
 * Highlights fenced code blocks after the sanitized markdown is in the DOM.
 * Doing it here (rather than inside a marked extension) keeps rendering
 * synchronous and lets grammars stream in lazily.
 */
export async function highlightCodeBlocks(container: HTMLElement): Promise<void> {
  const blocks = Array.from(container.querySelectorAll('pre > code'))

  await Promise.all(
    blocks.map(async (block) => {
      const language = Array.from(block.classList)
        .map((name) => LANGUAGE_CLASS.exec(name)?.[1])
        .find(Boolean)

      if (!language) return

      const pre = block.parentElement
      if (!pre) return

      try {
        const html = await highlightToHtml(block.textContent ?? '', language)
        // `html` comes from Shiki's own serializer, not from user markup.
        pre.outerHTML = html
      } catch {
        // Leave the plain block in place if the grammar fails to load.
      }
    }),
  )
}
