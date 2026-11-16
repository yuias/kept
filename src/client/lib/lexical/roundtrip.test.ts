import { $isCodeNode } from '@lexical/code-core'
import { $createHorizontalRuleNode, $isHorizontalRuleNode } from '@lexical/extension'
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from '@lexical/list'
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalNode } from 'lexical'
import { describe, expect, it } from 'vitest'
import { classifyRoundTrip } from './fidelity'
import { $exportMarkdown, $importMarkdown, createMarkdownEditor, roundTrip } from './markdown'
import { FENCED_CODE } from './transformers'

const load = (files: Record<string, string>, suffix: string): Map<string, string> =>
  new Map(
    Object.entries(files).map(([path, text]) => [path.slice(path.lastIndexOf('/') + 1, -suffix.length), text]),
  )

const identical = load(
  import.meta.glob('./fixtures/identical/*.md', { query: '?raw', import: 'default', eager: true }),
  '.md',
)
const normalizeIn = load(
  import.meta.glob('./fixtures/normalize/*.in.md', { query: '?raw', import: 'default', eager: true }),
  '.in.md',
)
const normalizeOut = load(
  import.meta.glob('./fixtures/normalize/*.out.md', { query: '?raw', import: 'default', eager: true }),
  '.out.md',
)

/**
 * Fixtures whose conversion is not supported yet. The tests below assert that
 * each one still fails, so an entry that starts passing must be removed here.
 */
const KNOWN_LOSSY = new Set<string>([
  'list-code',
  'tables',
  'table-padding',
])

const passesIdentical = (name: string): boolean => {
  const source = identical.get(name)!
  return roundTrip(source) === source
}

const passesNormalize = (name: string): boolean => {
  const output = normalizeOut.get(name)!
  return roundTrip(normalizeIn.get(name)!) === output && roundTrip(output) === output
}

describe('round-trip fixtures', () => {
  it('has a fixture for every known lossy name', () => {
    for (const name of KNOWN_LOSSY) {
      expect(identical.has(name) || normalizeIn.has(name), name).toBe(true)
    }
  })

  it('pairs every normalize input with an expected output', () => {
    expect([...normalizeIn.keys()].sort()).toEqual([...normalizeOut.keys()].sort())
  })

  describe('identical', () => {
    for (const [name, source] of identical) {
      it(name, () => {
        if (KNOWN_LOSSY.has(name)) expect(passesIdentical(name), 'now passes: remove it from KNOWN_LOSSY').toBe(false)
        else expect(roundTrip(source)).toBe(source)
      })
    }
  })

  describe('normalize', () => {
    for (const [name, source] of normalizeIn) {
      it(name, () => {
        if (KNOWN_LOSSY.has(name)) {
          expect(passesNormalize(name), 'now passes: remove it from KNOWN_LOSSY').toBe(false)
          return
        }
        const output = normalizeOut.get(name)!
        expect(roundTrip(source)).toBe(output)
        expect(roundTrip(output)).toBe(output)
        expect(classifyRoundTrip(source, output)).not.toBe('render-different')
      })
    }
  })
})

/** Imports `markdown` and describes every root child: its type, with code and list content. */
function rootShape(markdown: string): unknown[] {
  const editor = createMarkdownEditor()
  editor.update(() => $importMarkdown(markdown), { discrete: true })
  const shape = editor.read(() =>
    $getRoot()
      .getChildren()
      .map((node) => {
        if ($isCodeNode(node)) return ['code', node.getLanguage() ?? '', node.getTextContent()]
        if ($isListNode(node)) return [node.getListType(), ...node.getChildren().map((item) => item.getTextContent())]
        return node.getTextContent() === '' || $isHorizontalRuleNode(node) ? node.getType() : [node.getType(), node.getTextContent()]
      }),
  )
  editor.dispose()
  return shape
}

/** Exports a document made of `build()`, then reimports the markdown. */
function exportAndReload(build: () => LexicalNode[]): { markdown: string; shape: unknown[] } {
  const editor = createMarkdownEditor()
  editor.update(() => $getRoot().clear().append(...build()), { discrete: true })
  const markdown = editor.read(() => $exportMarkdown())
  editor.dispose()
  return { markdown, shape: rootShape(markdown) }
}

describe('check lists', () => {
  it('imports `- [x] a` and `- [ ] a` as check list items', () => {
    const editor = createMarkdownEditor()
    editor.update(() => $importMarkdown('- [x] a\n- [ ] b\n- [X] c'), { discrete: true })
    const items = editor.read(() => {
      const list = $getRoot().getFirstChild()
      if (!$isListNode(list)) throw new Error('not a list')
      return [list.getListType(), ...list.getChildren().map((item) => ($isListItemNode(item) ? item.getChecked() : null))]
    })
    editor.dispose()
    expect(items).toEqual(['check', true, false, true])
  })

  it('keeps unchecked and checked items apart from plain bullets', () => {
    expect(rootShape('- [ ] a\n\n- b')).toEqual([['check', 'a'], 'paragraph', ['bullet', 'b']])
  })
})

describe('bullet items that start with a task marker', () => {
  it('keeps a loaded escaped marker as it is', () => {
    expect(roundTrip('- \\[ ] x\n- \\[x] y\n- z')).toBe('- \\[ ] x\n- \\[x] y\n- z')
    expect(rootShape('- \\[ ] x')).toEqual([['bullet', '[ ] x']])
  })

  it.each(['[ ] x', '[x] x', '[X] x', '[] x', ' [ ] x'])('reimports a bullet item with text %j as a bullet', (text) => {
    const { markdown, shape } = exportAndReload(() => [$createListNode('bullet').append($createListItemNode().append($createTextNode(text)))])
    expect(shape).toEqual([['bullet', text]])
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('leaves the text of a task item and a later `[ ]` alone', () => {
    expect(roundTrip('- [x] [ ] y')).toBe('- [x] [ ] y')
    expect(roundTrip('- a [ ] y')).toBe('- a [ ] y')
    expect(roundTrip('1. [ ] y')).toBe('1. [ ] y')
  })
})

describe('rules', () => {
  it.each(['---', '***', '___', '* * *', '- - -', '-----', '  ---'])('reads %j as a rule', (line) => {
    expect(rootShape(`a\n\n${line}\n\nb`)).toEqual([['paragraph', 'a'], 'paragraph', 'horizontalrule', 'paragraph', ['paragraph', 'b']])
    expect(roundTrip(`${line}\n`)).toBe('---\n')
  })

  it('does not read an indented code line as a rule', () => {
    expect(rootShape('    ---')).toEqual([['paragraph', '    ---']])
  })
})

describe('fences', () => {
  it('reads a tilde fence and writes it back with backticks', () => {
    expect(rootShape('~~~js\nx\n~~~')).toEqual([['code', 'js', 'x']])
    expect(roundTrip('~~~js\nx\n~~~')).toBe('```js\nx\n```')
  })

  it('keeps backtick lines inside a tilde fence as content', () => {
    const source = '~~~\n```\nx\n```\n~~~'
    expect(rootShape(source)).toEqual([['code', '', '```\nx\n```']])
    expect(roundTrip(roundTrip(source))).toBe(roundTrip(source))
  })

  it('closes a tilde fence only with a fence at least as long', () => {
    expect(rootShape('~~~~\n~~~\n~~~~\nafter')).toEqual([['code', '', '~~~'], ['paragraph', 'after']])
  })

  it('runs an unclosed tilde fence to the end of the note', () => {
    expect(rootShape('~~~\nx\n\ny')).toEqual([['code', '', 'x\n\ny']])
  })

  it('does not close a backtick fence with a tilde line', () => {
    expect(rootShape('```\n~~~\n```')).toEqual([['code', '', '~~~']])
  })

  it('keeps the fence line leading whitespace in capture group 1', () => {
    expect(FENCED_CODE.regExpStart.exec('  ~~~js')![1]).toBe('  ~~~')
    expect(FENCED_CODE.regExpStart.exec('\t```')![1]).toBe('\t```')
  })
})

describe('typed text that looks like a block', () => {
  const lines = [
    '[ ] x',
    '[x] x',
    '[X] x',
    '[] x',
    '  [ ] x',
    '---',
    '***',
    '___',
    '* * *',
    '-- -',
    '~~~',
    '~~~js',
    '  ~~~~',
  ]

  it.each(lines)('stays one paragraph: %j', (line) => {
    const { markdown, shape } = exportAndReload(() => [$createParagraphNode().append($createTextNode(line))])
    expect(shape).toEqual([['paragraph', line]])
    // Second pass: the escaped text must be a fixed point.
    expect(roundTrip(markdown)).toBe(markdown)
  })
})

describe('rule nodes made in the editor', () => {
  it('writes a rule between paragraphs and reads it back', () => {
    const { markdown, shape } = exportAndReload(() => [
      $createParagraphNode().append($createTextNode('a')),
      $createHorizontalRuleNode(),
      $createParagraphNode().append($createTextNode('---')),
      $createHorizontalRuleNode(),
      $createParagraphNode().append($createTextNode('[ ] b')),
    ])
    expect(markdown).toBe('a\n---\n\\---\n---\n\\[ ] b')
    expect(shape).toEqual([['paragraph', 'a'], 'horizontalrule', ['paragraph', '---'], 'horizontalrule', ['paragraph', '[ ] b']])
  })
})
