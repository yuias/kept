import { stripLocalImages } from './images'

/** The markdown served by /raw: the title, when set, becomes a top-level heading. */
export function rawNoteText(title: string, body: string): string {
  return title !== '' ? `# ${title}\n\n${body}` : body
}

/** What "Copy" puts on the clipboard: the raw markdown without images. */
export function copyableNoteText(title: string, body: string): string {
  return rawNoteText(title, stripLocalImages(body)).replace(/\n+$/, '')
}
