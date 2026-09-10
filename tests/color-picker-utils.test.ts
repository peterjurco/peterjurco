// @vitest-environment jsdom

import { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addRecentColor,
  getRecentColors,
  resolveCurrentColor,
  rgbToHex,
} from '../src/components/color-picker-utils'
import { documentExtensions } from '../src/lib/articles/extensions'

describe('rgbToHex', () => {
  it('converts an rgb() string to lowercase hex', () => {
    expect(rgbToHex('rgb(23, 20, 15)')).toBe('#17140f')
  })

  it('converts an rgba() string, ignoring alpha', () => {
    expect(rgbToHex('rgba(240, 231, 211, 0.5)')).toBe('#f0e7d3')
  })

  it('pads single-digit hex components', () => {
    expect(rgbToHex('rgb(0, 5, 10)')).toBe('#00050a')
  })

  it('falls back to black for an unparseable value', () => {
    expect(rgbToHex('not-a-color')).toBe('#000000')
  })
})

describe('getRecentColors / addRecentColor', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('starts empty', () => {
    expect(getRecentColors()).toEqual([])
  })

  it('adds a color to the front', () => {
    addRecentColor('#c1793a')
    expect(getRecentColors()).toEqual(['#c1793a'])
  })

  it('most-recently-used first', () => {
    addRecentColor('#c1793a')
    addRecentColor('#a13d2e')
    expect(getRecentColors()).toEqual(['#a13d2e', '#c1793a'])
  })

  it('de-duplicates — reusing a color moves it to the front instead of repeating', () => {
    addRecentColor('#c1793a')
    addRecentColor('#a13d2e')
    addRecentColor('#c1793a')
    expect(getRecentColors()).toEqual(['#c1793a', '#a13d2e'])
  })

  it('caps at 5, dropping the oldest', () => {
    for (const hex of ['#111111', '#222222', '#333333', '#444444', '#555555']) {
      addRecentColor(hex)
    }
    addRecentColor('#666666')
    expect(getRecentColors()).toEqual([
      '#666666',
      '#555555',
      '#444444',
      '#333333',
      '#222222',
    ])
  })

  it('persists across reads (real localStorage round-trip)', () => {
    addRecentColor('#4b6b4c')
    expect(getRecentColors()).toEqual(['#4b6b4c'])
    expect(getRecentColors()).toEqual(['#4b6b4c'])
  })
})

describe('resolveCurrentColor', () => {
  function createEditor(contentHtml: string): Editor {
    const element = document.createElement('div')
    document.body.appendChild(element)
    return new Editor({
      element,
      extensions: documentExtensions(),
      content: contentHtml,
    })
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns the explicit color mark when one is set', () => {
    const editor = createEditor(
      '<p><span style="color: #ff0000">red text</span></p>',
    )
    editor.commands.selectAll()
    expect(resolveCurrentColor(editor)).toBe('#ff0000')
    editor.destroy()
  })

  it('falls back to the computed style when no color mark is set', () => {
    const editor = createEditor('<p>plain text</p>')
    const paragraph = editor.view.dom.querySelector('p')
    if (paragraph) paragraph.style.color = 'rgb(23, 20, 15)'
    editor.commands.selectAll()
    expect(resolveCurrentColor(editor)).toBe('#17140f')
    editor.destroy()
  })
})
