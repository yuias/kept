/** Turns CRLF and lone CR into LF. Pasted text from Windows usually carries CRLF. */
export function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}
