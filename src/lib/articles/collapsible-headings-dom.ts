import { hiddenBlocks } from './heading-sections'

/**
 * Public-page counterpart of the editor's CollapsibleHeadings plugin: the
 * article is server-rendered as flat HTML, so this adds an arrow button to
 * each top-level heading and hides/shows sibling blocks in place. Without
 * JS the article simply stays fully expanded.
 *
 * Section rules come from heading-sections.ts (shared with the editor) so
 * both agree on what a heading owns. State is in-memory only — expanded on
 * every load, never remembered.
 */

const HEADING_LEVEL = /^H([1-6])$/

function levelOf(element: Element): number | null {
  const match = HEADING_LEVEL.exec(element.tagName)
  return match ? Number(match[1]) : null
}

export function initCollapsibleHeadings(root: HTMLElement): void {
  const blocks = Array.from(root.children)
  const levels = blocks.map(levelOf)
  const collapsed = new Set<number>()
  const buttons = new Map<number, HTMLButtonElement>()

  function render(): void {
    const hidden = hiddenBlocks(levels, collapsed)
    blocks.forEach((block, index) => {
      block.classList.toggle('collapsed-by-heading', hidden[index] ?? false)
      block.classList.toggle('is-collapsed', collapsed.has(index))
    })
    for (const [index, button] of buttons) {
      const isCollapsed = collapsed.has(index)
      button.setAttribute('aria-expanded', String(!isCollapsed))
      button.setAttribute(
        'aria-label',
        isCollapsed ? 'Expand section' : 'Collapse section',
      )
    }
  }

  blocks.forEach((block, index) => {
    if (levels[index] === null) return
    // A heading's accessible name would otherwise absorb the button's label.
    block.setAttribute('aria-label', block.textContent?.trim() ?? '')

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'heading-toggle'
    button.addEventListener('click', () => {
      if (collapsed.has(index)) collapsed.delete(index)
      else collapsed.add(index)
      render()
    })
    block.prepend(button)
    buttons.set(index, button)
  })

  render()
}
