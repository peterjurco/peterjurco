// @vitest-environment jsdom

import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { CollapsibleHeadings } from '../src/lib/articles/collapsible-headings'
import { documentExtensions } from '../src/lib/articles/extensions'

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function heading(level: number, text: string) {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  }
}

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function createEditor(content: JSONContent[]): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [...documentExtensions(), CollapsibleHeadings],
    content: { type: 'doc', content },
  })
  editors.push(editor)
  return editor
}

/** The top-level DOM blocks, minus nothing — hidden ones keep their element. */
function blocks(editor: Editor): HTMLElement[] {
  return Array.from(editor.view.dom.children) as HTMLElement[]
}

function hiddenTexts(editor: Editor): string[] {
  return blocks(editor)
    .filter((el) => el.classList.contains('collapsed-by-heading'))
    .map((el) => el.textContent ?? '')
}

function toggleFor(editor: Editor, headingText: string): HTMLButtonElement {
  const el = blocks(editor).find(
    (block) =>
      /^H[1-6]$/.test(block.tagName) &&
      (block.textContent ?? '').includes(headingText),
  )
  const button = el?.querySelector<HTMLButtonElement>('.heading-toggle')
  if (!button) throw new Error(`no toggle for heading "${headingText}"`)
  return button
}

// 0:H2 Alpha  1:p one  2:H3 Sub  3:p two  4:H2 Beta  5:p three
const DOC = [
  heading(2, 'Alpha'),
  paragraph('one'),
  heading(3, 'Sub'),
  paragraph('two'),
  heading(2, 'Beta'),
  paragraph('three'),
]

describe('CollapsibleHeadings', () => {
  it('puts an expanded toggle on every heading and hides nothing at first', () => {
    const editor = createEditor(DOC)
    const toggles = editor.view.dom.querySelectorAll('.heading-toggle')
    expect(toggles).toHaveLength(3)
    for (const toggle of toggles) {
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
    }
    expect(hiddenTexts(editor)).toEqual([])
  })

  it('collapsing a heading hides its section up to the next same-level heading', () => {
    const editor = createEditor(DOC)
    toggleFor(editor, 'Alpha').click()

    // "Sub"'s own toggle widget is empty text, so textContent is just the title.
    expect(hiddenTexts(editor)).toEqual(['one', 'Sub', 'two'])
    expect(toggleFor(editor, 'Alpha').getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(toggleFor(editor, 'Alpha').getAttribute('aria-label')).toBe(
      'Expand section',
    )
  })

  it('clicking again expands it', () => {
    const editor = createEditor(DOC)
    toggleFor(editor, 'Alpha').click()
    toggleFor(editor, 'Alpha').click()
    expect(hiddenTexts(editor)).toEqual([])
  })

  it('collapsing a nested heading only hides its own body', () => {
    const editor = createEditor(DOC)
    toggleFor(editor, 'Sub').click()
    expect(hiddenTexts(editor)).toEqual(['two'])
  })

  it('a collapsed parent keeps a nested collapsed section hidden after expanding the child', () => {
    const editor = createEditor(DOC)
    toggleFor(editor, 'Sub').click()
    toggleFor(editor, 'Alpha').click()
    expect(hiddenTexts(editor)).toEqual(['one', 'Sub', 'two'])

    // Expanding the parent again leaves "Sub" itself still collapsed.
    toggleFor(editor, 'Alpha').click()
    expect(hiddenTexts(editor)).toEqual(['two'])
  })

  it('never changes the document — collapsing is view-only', () => {
    const editor = createEditor(DOC)
    const before = editor.getJSON()
    toggleFor(editor, 'Alpha').click()
    toggleFor(editor, 'Beta').click()
    expect(editor.getJSON()).toEqual(before)
  })

  it('keeps a heading collapsed when text is inserted above it', () => {
    const editor = createEditor(DOC)
    toggleFor(editor, 'Beta').click()
    expect(hiddenTexts(editor)).toEqual(['three'])

    editor.commands.insertContentAt(0, '<p>new intro</p>')
    expect(hiddenTexts(editor)).toEqual(['three'])
  })

  it('stops collapsing a heading once it is turned into a paragraph', () => {
    const editor = createEditor(DOC)
    toggleFor(editor, 'Beta').click()
    expect(hiddenTexts(editor)).toEqual(['three'])

    let betaPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Beta') betaPos = pos
    })
    editor.commands.setTextSelection(betaPos)
    editor.commands.setParagraph()

    expect(hiddenTexts(editor)).toEqual([])
    expect(editor.view.dom.querySelectorAll('.heading-toggle')).toHaveLength(2)
  })

  it('reveals a collapsed section when the caret moves into it', () => {
    const editor = createEditor(DOC)
    toggleFor(editor, 'Alpha').click()
    expect(hiddenTexts(editor)).toEqual(['one', 'Sub', 'two'])

    // Place the caret inside paragraph "one" (position 1 block after Alpha).
    let paragraphPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'one') paragraphPos = pos
    })
    editor.commands.setTextSelection(paragraphPos)
    expect(hiddenTexts(editor)).toEqual([])
  })

  it('does not toggle headings that are not top-level (e.g. inside a blockquote)', () => {
    const editor = createEditor([
      { type: 'blockquote', content: [heading(2, 'Quoted')] },
      paragraph('after'),
    ])
    expect(editor.view.dom.querySelectorAll('.heading-toggle')).toHaveLength(0)
  })
})
