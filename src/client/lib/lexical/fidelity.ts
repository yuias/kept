import { marked } from 'marked'

export type RoundTripClass = 'identical' | 'render-equal' | 'render-different'

// The editor keeps no difference between `**a<br>b**` and `**a**<br>**b**` (a line
// break ends the format run) or between the spellings of a line break, and shows
// them the same, so their HTML is compared as equal.
const SPLIT_FORMAT = /<\/(strong|em|del)><br><\1>/g

function render(markdown: string): string {
  let html = marked.parse(markdown, { async: false }).replace(/<br\s*\/?>/gi, '<br>')
  for (let previous = ''; previous !== html; ) {
    previous = html
    html = html.replace(SPLIT_FORMAT, '<br>')
  }
  return html
}

/** Compares `source` with `exported` byte-wise, then by `marked.parse` HTML. */
export function classifyRoundTrip(source: string, exported: string): RoundTripClass {
  if (source === exported) return 'identical'
  return render(source) === render(exported) ? 'render-equal' : 'render-different'
}
