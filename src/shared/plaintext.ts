import { marked } from 'marked'
import type { Token, Tokens } from 'marked'

// Strips the markup marked's own renderer would add, so cards can show a
// plain preview without shipping a renderer (or DOM) into the Worker.
export function markdownToPlain(md: string): string {
  const tokens = marked.lexer(md)
  const lines = blockTokensToLines(tokens)
  return collapseBlankLines(lines.join('\n')).trim()
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n')
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '')
}

function blockTokensToLines(tokens: Token[]): string[] {
  const lines: string[] = []
  for (const token of tokens) {
    const text = blockToText(token)
    if (text !== null) lines.push(text)
  }
  return lines
}

// `Token` also includes `Tokens.Generic`, whose `type` is a plain `string`,
// so a switch on `token.type` cannot narrow away Generic. Cast explicitly
// instead; marked's own lexer never actually produces Generic tokens here.
function blockToText(token: Token): string | null {
  switch (token.type) {
    case 'space':
    case 'hr':
    case 'def':
      return null
    case 'heading':
    case 'paragraph': {
      const t = token as Tokens.Heading | Tokens.Paragraph
      return inlineToText(t.tokens)
    }
    case 'text': {
      // Only reached inside loose list items, where marked lexes each
      // paragraph as a block-level text token rather than a paragraph token.
      const t = token as Tokens.Text
      return t.tokens ? inlineToText(t.tokens) : t.text
    }
    case 'code':
      return (token as Tokens.Code).text
    case 'blockquote':
      return blockTokensToLines((token as Tokens.Blockquote).tokens).join('\n')
    case 'list':
      return listToLines(token as Tokens.List).join('\n')
    case 'table':
      return tableToText(token as Tokens.Table)
    case 'html':
      return stripTags((token as Tokens.HTML).text)
    default: {
      const generic = token as Tokens.Generic
      if (Array.isArray(generic.tokens)) return blockTokensToLines(generic.tokens).join('\n')
      return typeof generic.text === 'string' ? generic.text : null
    }
  }
}

function listToLines(list: Tokens.List): string[] {
  const lines: string[] = []
  for (const item of list.items) lines.push(...blockTokensToLines(item.tokens))
  return lines
}

function tableToText(table: Tokens.Table): string {
  const rows = [table.header, ...table.rows]
  return rows.map((row) => row.map((cell) => inlineToText(cell.tokens)).join(' ')).join('\n')
}

function inlineToText(tokens: Token[]): string {
  return tokens.map(inlineTokenToText).join('')
}

function inlineTokenToText(token: Token): string {
  switch (token.type) {
    case 'text': {
      const t = token as Tokens.Text
      return t.tokens ? inlineToText(t.tokens) : t.text
    }
    case 'escape':
    case 'codespan':
      return (token as Tokens.Escape | Tokens.Codespan).text
    case 'strong':
    case 'em':
    case 'del':
    case 'link': {
      const t = token as Tokens.Strong | Tokens.Em | Tokens.Del | Tokens.Link
      return inlineToText(t.tokens)
    }
    case 'image':
      return ''
    case 'br':
      return ' '
    case 'html':
      return stripTags((token as Tokens.HTML).text)
    default: {
      const generic = token as Tokens.Generic
      if (Array.isArray(generic.tokens)) return inlineToText(generic.tokens)
      return typeof generic.text === 'string' ? generic.text : ''
    }
  }
}
