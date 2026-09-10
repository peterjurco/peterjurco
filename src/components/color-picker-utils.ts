import type { Editor } from '@tiptap/core'

/**
 * Text-color picker internals for EditorToolbar.tsx / ColorSwatchPicker.tsx:
 * resolving what color is "currently" showing (explicit mark, or the real
 * rendered color when none is set) and the localStorage-backed recent-colors
 * list.
 */

const RECENT_COLORS_KEY = 'peterjurco-recent-colors'
const RECENT_COLORS_LIMIT = 5

/** Parses `rgb(r, g, b)` / `rgba(r, g, b, a)` into `#rrggbb`; alpha is ignored. */
export function rgbToHex(rgb: string): string {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)
  if (!match) return '#000000'
  const [, r, g, b] = match as unknown as [string, string, string, string]
  const toHex = (component: string) =>
    Number(component).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * The color the toolbar swatch should show for the current selection: the
 * explicit `color` mark when one is set, otherwise the REAL rendered color
 * (read from the DOM via getComputedStyle) — never a hardcoded guess. That
 * matters because "no explicit color" renders differently in light vs. dark
 * theme, so a fixed fallback (e.g. always black) is wrong half the time.
 */
export function resolveCurrentColor(editor: Editor): string {
  const explicit = editor.getAttributes('textStyle').color as string | undefined
  if (explicit) return explicit

  try {
    const result = editor.view.domAtPos(editor.state.selection.from)
    // domAtPos can return the PARENT container with an offset into its
    // children (e.g. position 0 of a doc resolves to the editor root, offset
    // 0) rather than the node actually at the cursor — step into that child
    // first, or getComputedStyle would read the wrong (ancestor) element.
    let element: Node | null =
      result.node.nodeType === Node.ELEMENT_NODE
        ? (result.node.childNodes[result.offset] ?? result.node)
        : result.node
    while (element && element.nodeType !== Node.ELEMENT_NODE) {
      element = element.parentNode
    }
    if (!element) return '#000000'
    return rgbToHex(getComputedStyle(element as Element).color)
  } catch {
    return '#000000'
  }
}

/** Most-recently-used first. Never throws — a storage failure just means no recents. */
export function getRecentColors(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_COLORS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')
      ? parsed
      : []
  } catch {
    return []
  }
}

/**
 * Records `hex` as the most recently used color: moves it to the front if
 * already present (no duplicates), caps the list at RECENT_COLORS_LIMIT.
 * Returns the updated list. Never throws (e.g. private-browsing storage
 * writes can fail) — the in-memory result is still returned either way.
 */
export function addRecentColor(hex: string): string[] {
  const next = [hex, ...getRecentColors().filter((c) => c !== hex)].slice(
    0,
    RECENT_COLORS_LIMIT,
  )
  try {
    window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next))
  } catch {
    // Best-effort — an in-memory-only session still works.
  }
  return next
}
