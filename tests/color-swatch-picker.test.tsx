// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ColorSwatchPicker,
  PRESET_COLORS,
} from '../src/components/ColorSwatchPicker'
import { documentExtensions } from '../src/lib/articles/extensions'

function createEditor(contentHtml = '<p>hello</p>'): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: documentExtensions(),
    content: contentHtml,
  })
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('ColorSwatchPicker', () => {
  it('renders a trigger button and opens a popover with all 10 presets plus a custom swatch', () => {
    const editor = createEditor()
    render(<ColorSwatchPicker editor={editor} />)

    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByTitle('Text color'))
    expect(screen.getByRole('menu')).toBeTruthy()
    for (const { label } of PRESET_COLORS) {
      expect(screen.getByTitle(label)).toBeTruthy()
    }
    expect(screen.getByTitle('Custom color')).toBeTruthy()
    editor.destroy()
  })

  it('applies a preset color to the selection and closes the popover', () => {
    const editor = createEditor()
    editor.commands.selectAll()
    render(<ColorSwatchPicker editor={editor} />)

    fireEvent.click(screen.getByTitle('Text color'))
    fireEvent.click(screen.getByTitle(PRESET_COLORS[0].label))

    expect(editor.getAttributes('textStyle').color).toBe(PRESET_COLORS[0].hex)
    expect(screen.queryByRole('menu')).toBeNull()
    editor.destroy()
  })

  it('shows a recent-colors row after a pick, most-recent first, and reusing it works', () => {
    const editor = createEditor()
    editor.commands.selectAll()
    render(<ColorSwatchPicker editor={editor} />)

    fireEvent.click(screen.getByTitle('Text color'))
    expect(screen.queryByLabelText(/Recent color/)).toBeNull()
    fireEvent.click(screen.getByTitle(PRESET_COLORS[2].label))

    fireEvent.click(screen.getByTitle('Text color'))
    const recent = screen.getByLabelText(`Recent color ${PRESET_COLORS[2].hex}`)
    expect(recent).toBeTruthy()

    fireEvent.click(recent)
    expect(editor.getAttributes('textStyle').color).toBe(PRESET_COLORS[2].hex)
    editor.destroy()
  })

  it('de-duplicates recents — reusing a color keeps only one entry, moved to the front', () => {
    const editor = createEditor()
    editor.commands.selectAll()
    render(<ColorSwatchPicker editor={editor} />)

    fireEvent.click(screen.getByTitle('Text color'))
    fireEvent.click(screen.getByTitle(PRESET_COLORS[0].label))
    fireEvent.click(screen.getByTitle('Text color'))
    fireEvent.click(screen.getByTitle(PRESET_COLORS[1].label))
    fireEvent.click(screen.getByTitle('Text color'))
    fireEvent.click(
      screen.getByLabelText(`Recent color ${PRESET_COLORS[0].hex}`),
    )

    fireEvent.click(screen.getByTitle('Text color'))
    expect(
      screen
        .getAllByLabelText(/Recent color/)
        .map((el) => el.getAttribute('aria-label')),
    ).toEqual([
      `Recent color ${PRESET_COLORS[0].hex}`,
      `Recent color ${PRESET_COLORS[1].hex}`,
    ])
    editor.destroy()
  })

  it('closes the popover on Escape', () => {
    const editor = createEditor()
    render(<ColorSwatchPicker editor={editor} />)

    fireEvent.click(screen.getByTitle('Text color'))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    editor.destroy()
  })

  it('closes the popover on an outside click', () => {
    const editor = createEditor()
    render(
      <div>
        <ColorSwatchPicker editor={editor} />
        <button type="button">outside</button>
      </div>,
    )

    fireEvent.click(screen.getByTitle('Text color'))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).toBeNull()
    editor.destroy()
  })

  it('shows the real computed color, not a hardcoded black, when no color mark is set', () => {
    const editor = createEditor()
    const paragraph = editor.view.dom.querySelector('p')
    if (paragraph) paragraph.style.color = 'rgb(240, 231, 211)'
    editor.commands.selectAll()
    render(<ColorSwatchPicker editor={editor} />)

    const trigger = screen.getByTitle('Text color') as HTMLButtonElement
    expect(trigger.style.backgroundColor).toBe('rgb(240, 231, 211)')
    editor.destroy()
  })

  it('the custom swatch opens the native color input, seeded with the current color', () => {
    const editor = createEditor()
    editor.commands.selectAll()
    editor.chain().setColor(PRESET_COLORS[3].hex).run()
    render(<ColorSwatchPicker editor={editor} />)

    fireEvent.click(screen.getByTitle('Text color'))
    const customInput = screen.getByLabelText(
      'Custom color',
    ) as HTMLInputElement
    expect(customInput.type).toBe('color')
    expect(customInput.value).toBe(PRESET_COLORS[3].hex)

    fireEvent.change(customInput, { target: { value: '#123456' } })
    expect(editor.getAttributes('textStyle').color).toBe('#123456')
    editor.destroy()
  })
})
