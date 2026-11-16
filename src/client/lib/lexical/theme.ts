import type { EditorThemeClasses } from 'lexical'

/**
 * Class names Lexical puts on the editor's DOM. The styles live in
 * `components/rich-editor.css`; the node types without a Lexical-owned element
 * (image, card) name the class their views are expected to carry.
 */
export const theme: EditorThemeClasses = {
  paragraph: 'rich-p',
  heading: { h1: 'rich-h1', h2: 'rich-h2', h3: 'rich-h3', h4: 'rich-h4', h5: 'rich-h5', h6: 'rich-h6' },
  quote: 'rich-quote',
  code: 'rich-codeblock',
  hr: 'rich-rule',
  hrSelected: 'rich-rule-selected',
  link: 'rich-link',
  list: {
    ul: 'rich-ul',
    ol: 'rich-ol',
    checklist: 'rich-checklist',
    listitem: 'rich-li',
    listitemChecked: 'rich-li-checked',
    listitemUnchecked: 'rich-li-unchecked',
    nested: { listitem: 'rich-li-nested' },
  },
  table: 'rich-table',
  // Without this class Lexical falls back to an inline `overflow-x` and warns in development.
  tableScrollableWrapper: 'rich-table-scroll',
  tableRow: 'rich-tr',
  tableCell: 'rich-td',
  tableCellHeader: 'rich-th',
  text: {
    bold: 'rich-bold',
    italic: 'rich-italic',
    strikethrough: 'rich-strike',
    code: 'rich-code',
  },
  image: 'rich-image',
  card: 'rich-card',
}
