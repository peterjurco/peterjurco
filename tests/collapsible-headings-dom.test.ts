// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { initCollapsibleHeadings } from '../src/lib/articles/collapsible-headings-dom'

afterEach(() => {
  document.body.innerHTML = ''
})

function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'article-body'
  root.innerHTML = html
  document.body.appendChild(root)
  initCollapsibleHeadings(root)
  return root
}

function hidden(root: HTMLElement): string[] {
  return Array.from(root.children)
    .filter((el) => el.classList.contains('collapsed-by-heading'))
    .map((el) => el.textContent ?? '')
}

function toggle(root: HTMLElement, headingText: string): HTMLButtonElement {
  const heading = Array.from(root.children).find(
    (el) =>
      /^H[1-6]$/.test(el.tagName) && el.textContent?.includes(headingText),
  )
  const button = heading?.querySelector<HTMLButtonElement>('.heading-toggle')
  if (!button) throw new Error(`no toggle for "${headingText}"`)
  return button
}

const HTML = `
  <h2>Alpha</h2><p>one</p>
  <h3>Sub</h3><p>two</p>
  <h2>Beta</h2><p>three</p>
`

describe('initCollapsibleHeadings', () => {
  it('adds an expanded toggle to every heading and hides nothing', () => {
    const root = mount(HTML)
    const toggles = root.querySelectorAll('.heading-toggle')
    expect(toggles).toHaveLength(3)
    for (const button of toggles) {
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(button.getAttribute('aria-label')).toBe('Collapse section')
    }
    expect(hidden(root)).toEqual([])
  })

  it('collapses a section up to the next same-level heading and back', () => {
    const root = mount(HTML)
    toggle(root, 'Alpha').click()
    expect(hidden(root)).toEqual(['one', 'Sub', 'two'])
    expect(toggle(root, 'Alpha').getAttribute('aria-expanded')).toBe('false')
    expect(toggle(root, 'Alpha').getAttribute('aria-label')).toBe(
      'Expand section',
    )

    toggle(root, 'Alpha').click()
    expect(hidden(root)).toEqual([])
  })

  it('collapsing a nested heading only hides its own body', () => {
    const root = mount(HTML)
    toggle(root, 'Sub').click()
    expect(hidden(root)).toEqual(['two'])
  })

  it('re-expanding a parent leaves a collapsed child collapsed', () => {
    const root = mount(HTML)
    toggle(root, 'Sub').click()
    toggle(root, 'Alpha').click()
    toggle(root, 'Alpha').click()
    expect(hidden(root)).toEqual(['two'])
  })

  it('marks the collapsed heading itself, which stays visible', () => {
    const root = mount(HTML)
    toggle(root, 'Beta').click()
    const beta = toggle(root, 'Beta').parentElement
    expect(beta?.classList.contains('is-collapsed')).toBe(true)
    expect(beta?.classList.contains('collapsed-by-heading')).toBe(false)
  })

  it('keeps each heading named by its own text, not the button label', () => {
    const root = mount('<h2>Alpha</h2><p>x</p>')
    expect(root.querySelector('h2')?.getAttribute('aria-label')).toBe('Alpha')
  })

  it('does nothing to an article without headings', () => {
    const root = mount('<p>just text</p>')
    expect(root.querySelectorAll('.heading-toggle')).toHaveLength(0)
    expect(hidden(root)).toEqual([])
  })
})
