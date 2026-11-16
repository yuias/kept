import { marked } from 'marked'

export type RoundTripClass = 'identical' | 'render-equal' | 'render-different'

const render = (markdown: string): string => marked.parse(markdown, { async: false })

/** Compares `source` with `exported` byte-wise, then by `marked.parse` HTML. */
export function classifyRoundTrip(source: string, exported: string): RoundTripClass {
  if (source === exported) return 'identical'
  return render(source) === render(exported) ? 'render-equal' : 'render-different'
}
