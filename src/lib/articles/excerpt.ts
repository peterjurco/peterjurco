/**
 * Derives a plain-text excerpt from a stored TipTap/ProseMirror document —
 * used as the OG/Twitter description (DATA_MODEL: "auto-derived from content
 * at render time — no separate excerpt column").
 */

interface JsonNode {
  type?: unknown
  text?: unknown
  content?: unknown
}

function isNode(value: unknown): value is JsonNode {
  return typeof value === 'object' && value !== null
}

/** Concatenated text of a node's subtree, marks ignored. */
function textOf(node: JsonNode): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content
    .filter(isNode)
    .map((child) => textOf(child))
    .join('')
}

/**
 * Body text per block, in document order. Headings are skipped — the title
 * belongs in og:title, not the description.
 */
function blockTexts(node: JsonNode, out: string[]): void {
  if (node.type === 'heading') return
  if (typeof node.text === 'string') {
    out.push(node.text)
    return
  }
  if (node.type === 'paragraph') {
    const text = textOf(node).trim()
    if (text.length > 0) out.push(text)
    return
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (isNode(child)) blockTexts(child, out)
    }
  }
}

/**
 * Plain text from the first paragraph(s) of the document, up to `max`
 * characters. Truncation happens at a word boundary and appends an ellipsis.
 */
export function deriveExcerpt(content: unknown, max = 200): string {
  if (!isNode(content) || content.type !== 'doc') return ''

  const blocks: string[] = []
  blockTexts(content, blocks)
  let text = ''
  for (const block of blocks) {
    text = text.length === 0 ? block : `${text} ${block}`
    if (text.length > max) break
  }
  if (text.length <= max) return text

  const cut = text.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
