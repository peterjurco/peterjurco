import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { hiddenBlocks, sectionEnds } from './heading-sections'

/**
 * Google-Docs-style collapsible headings for the editor: an arrow next to
 * every top-level heading folds away everything up to the next heading of
 * the same or a higher level.
 *
 * Editor-only (like ImagePasteUpload, deliberately NOT in
 * documentExtensions()): the collapsed set lives in plugin state and is
 * painted with decorations, so it never reaches `editor.getJSON()` — folding
 * is a view toggle, never saved with the article.
 */

const collapsibleKey = new PluginKey<Set<number>>('collapsibleHeadings')

interface Block {
  pos: number
  node: PMNode
  level: number | null
}

/** Top-level blocks with their heading level (null for non-headings). */
function topLevelBlocks(doc: PMNode): Block[] {
  const blocks: Block[] = []
  doc.forEach((node, pos) => {
    const level =
      node.type.name === 'heading' ? (node.attrs.level as number) : null
    blocks.push({ pos, node, level })
  })
  return blocks
}

/** Maps collapsed heading positions through an edit, dropping any that stopped being a heading. */
function remap(
  collapsed: Set<number>,
  doc: PMNode,
  map: (pos: number) => number,
): Set<number> {
  const next = new Set<number>()
  for (const pos of collapsed) {
    const mapped = map(pos)
    const node = mapped <= doc.content.size ? doc.nodeAt(mapped) : null
    if (node?.type.name === 'heading') next.add(mapped)
  }
  return next
}

/** Un-collapses every heading whose hidden section contains `selectionPos`, so the caret is never stranded in folded content. */
function revealSelection(
  collapsed: Set<number>,
  doc: PMNode,
  selectionPos: number,
): Set<number> {
  const blocks = topLevelBlocks(doc)
  const ends = sectionEnds(blocks.map((block) => block.level))
  const next = new Set(collapsed)
  blocks.forEach((block, index) => {
    if (!collapsed.has(block.pos)) return
    const end = ends.get(index) ?? index + 1
    const first = blocks[index + 1]
    const last = blocks[end - 1]
    if (!first || end - 1 <= index) return
    const sectionStart = first.pos
    const sectionEnd = last.pos + last.node.nodeSize
    if (selectionPos >= sectionStart && selectionPos <= sectionEnd) {
      next.delete(block.pos)
    }
  })
  return next
}

function createToggle(collapsed: boolean): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'heading-toggle'
  button.contentEditable = 'false'
  button.setAttribute('aria-expanded', String(!collapsed))
  button.setAttribute(
    'aria-label',
    collapsed ? 'Expand section' : 'Collapse section',
  )
  return button
}

export const CollapsibleHeadings = Extension.create({
  name: 'collapsibleHeadings',

  addProseMirrorPlugins() {
    return [
      new Plugin<Set<number>>({
        key: collapsibleKey,
        state: {
          init: () => new Set<number>(),
          apply(tr, collapsed, _oldState, newState) {
            let next = collapsed
            if (tr.docChanged) {
              next = remap(next, newState.doc, (pos) => tr.mapping.map(pos))
            }
            const toggle = tr.getMeta(collapsibleKey) as
              | { toggle: number }
              | undefined
            if (toggle) {
              next = new Set(next)
              if (next.has(toggle.toggle)) next.delete(toggle.toggle)
              else next.add(toggle.toggle)
            } else if (tr.selectionSet || tr.docChanged) {
              next = revealSelection(
                next,
                newState.doc,
                newState.selection.head,
              )
            }
            return next
          },
        },
        props: {
          decorations(state) {
            const collapsed = collapsibleKey.getState(state) ?? new Set()
            const blocks = topLevelBlocks(state.doc)
            const indexByPos = new Map(
              blocks.map((block, index) => [block.pos, index]),
            )
            const collapsedIndexes = new Set<number>()
            for (const pos of collapsed) {
              const index = indexByPos.get(pos)
              if (index !== undefined) collapsedIndexes.add(index)
            }
            const hidden = hiddenBlocks(
              blocks.map((block) => block.level),
              collapsedIndexes,
            )

            const decorations: Decoration[] = []
            blocks.forEach((block, index) => {
              const end = block.pos + block.node.nodeSize
              if (block.level !== null) {
                const isCollapsed = collapsedIndexes.has(index)
                decorations.push(
                  Decoration.widget(
                    block.pos + 1,
                    () => createToggle(isCollapsed),
                    {
                      side: -1,
                      key: `heading-toggle-${isCollapsed}`,
                    },
                  ),
                )
                if (isCollapsed) {
                  decorations.push(
                    Decoration.node(block.pos, end, { class: 'is-collapsed' }),
                  )
                }
              }
              if (hidden[index]) {
                decorations.push(
                  Decoration.node(block.pos, end, {
                    class: 'collapsed-by-heading',
                  }),
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },

          handleDOMEvents: {
            // Keep the click from moving the caret / stealing editor focus.
            mousedown(_view, event) {
              const target = event.target as HTMLElement | null
              if (target?.closest('.heading-toggle')) {
                event.preventDefault()
                return true
              }
              return false
            },
            click(view, event) {
              const button = (event.target as HTMLElement | null)?.closest(
                '.heading-toggle',
              )
              if (!button) return false
              // The widget sits just inside its heading: resolve that heading.
              const inside = view.posAtDOM(button, 0)
              const $pos = view.state.doc.resolve(inside)
              if ($pos.depth !== 1 || $pos.parent.type.name !== 'heading') {
                return false
              }
              view.dispatch(
                view.state.tr.setMeta(collapsibleKey, {
                  toggle: $pos.before(1),
                }),
              )
              return true
            },
          },
        },
      }),
    ]
  },
})
