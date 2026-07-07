import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string'
import { documentExtensions } from './extensions'

/**
 * ProseMirror JSON → sanitized HTML for the public SSR read view.
 *
 * Sanitization happens on the JSON before serialization: every node, mark and
 * attribute must pass an allow-list, unsafe URLs and style values are dropped,
 * and unknown types are removed entirely. `renderToHTMLString`
 * (@tiptap/static-renderer — string serialization, no DOM at all, so it runs
 * on the Workers runtime AND in vitest) then escapes all text content, so
 * nothing user-controlled can reach the page as markup. (@tiptap/html was
 * rejected: its import resolves to a real-DOM build under workerd.)
 */

interface JsonMark {
  type?: unknown
  attrs?: Record<string, unknown>
}

interface JsonNode {
  type?: unknown
  attrs?: Record<string, unknown>
  marks?: unknown
  content?: unknown
  text?: unknown
}

/** http(s), mailto or relative — never javascript:, data:, vbscript:, … */
function isSafeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  // Browsers strip ASCII control chars and whitespace when parsing URLs, so
  // `java\nscript:alert(1)` still runs — strip them BEFORE scheme matching.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that's the point
  const normalized = value.replace(/[\u0000-\u0020]/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)
  if (!scheme?.[1]) return true // relative URL
  return ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase())
}

/**
 * Values end up inside a style="" attribute — restrict to a charset that can
 * express colors (`#fff`, `rgb(1,2,3)`, `red`) but never `;`, quotes, or
 * `url(...)`.
 */
function isSafeStyleValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[#a-zA-Z0-9.,%() -]+$/.test(value) &&
    !/url/i.test(value)
  )
}

/** Font stacks additionally need single quotes: 'Times New Roman', serif */
function isSafeFontFamily(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9,' -]+$/.test(value)
}

type MarkSanitizer = (
  attrs: Record<string, unknown>,
) => Record<string, unknown> | null

const ALLOWED_MARKS: Record<string, MarkSanitizer> = {
  bold: () => ({}),
  italic: () => ({}),
  strike: () => ({}),
  underline: () => ({}),
  code: () => ({}),
  link: (attrs) => (isSafeUrl(attrs.href) ? { href: attrs.href } : null),
  textStyle: (attrs) => {
    const safe: Record<string, unknown> = {}
    if (isSafeStyleValue(attrs.color)) safe.color = attrs.color
    if (isSafeFontFamily(attrs.fontFamily)) safe.fontFamily = attrs.fontFamily
    return Object.keys(safe).length > 0 ? safe : null
  },
}

/** Returns sanitized attrs, or null when the whole node must be dropped. */
type NodeSanitizer = (
  attrs: Record<string, unknown>,
) => Record<string, unknown> | null

const ALLOWED_NODES: Record<string, NodeSanitizer> = {
  doc: () => ({}),
  paragraph: () => ({}),
  text: () => ({}),
  heading: (attrs) => ({
    level:
      typeof attrs.level === 'number' && attrs.level >= 1 && attrs.level <= 6
        ? attrs.level
        : 2,
  }),
  blockquote: () => ({}),
  bulletList: () => ({}),
  orderedList: (attrs) =>
    typeof attrs.start === 'number' ? { start: attrs.start } : {},
  listItem: () => ({}),
  hardBreak: () => ({}),
  horizontalRule: () => ({}),
  codeBlock: (attrs) => ({
    language:
      typeof attrs.language === 'string' && /^[\w-]*$/.test(attrs.language)
        ? attrs.language
        : null,
  }),
  image: (attrs) => {
    if (!isSafeUrl(attrs.src)) return null
    const safe: Record<string, unknown> = { src: attrs.src }
    if (typeof attrs.alt === 'string') safe.alt = attrs.alt
    if (typeof attrs.title === 'string') safe.title = attrs.title
    return safe
  },
}

function sanitizeMarks(marks: unknown): JsonMark[] {
  if (!Array.isArray(marks)) return []
  const safe: JsonMark[] = []
  for (const mark of marks) {
    if (typeof mark !== 'object' || mark === null) continue
    const { type, attrs } = mark as JsonMark
    if (typeof type !== 'string') continue
    const sanitizer = ALLOWED_MARKS[type]
    if (!sanitizer) continue
    const safeAttrs = sanitizer(attrs ?? {})
    if (safeAttrs === null) continue
    safe.push({ type, attrs: safeAttrs })
  }
  return safe
}

function sanitizeNode(node: unknown): JsonNode | null {
  if (typeof node !== 'object' || node === null) return null
  const { type, attrs, marks, content, text } = node as JsonNode
  if (typeof type !== 'string') return null
  const sanitizer = ALLOWED_NODES[type]
  if (!sanitizer) return null
  const safeAttrs = sanitizer(attrs ?? {})
  if (safeAttrs === null) return null

  const safe: JsonNode = { type, attrs: safeAttrs }
  if (type === 'text') {
    if (typeof text !== 'string' || text.length === 0) return null
    safe.text = text
  }
  const safeMarks = sanitizeMarks(marks)
  if (safeMarks.length > 0) safe.marks = safeMarks
  if (Array.isArray(content)) {
    safe.content = content
      .map((child) => sanitizeNode(child))
      .filter((child): child is JsonNode => child !== null)
  }
  return safe
}

/**
 * Renders a stored article document to safe HTML. Malformed input renders as
 * an empty string rather than throwing — a corrupt row must not 500 the page.
 */
export function renderDoc(content: unknown): string {
  const safeDoc = sanitizeNode(content)
  if (safeDoc?.type !== 'doc') return ''
  try {
    return renderToHTMLString({
      // biome-ignore lint/suspicious/noExplicitAny: renderToHTMLString wants TipTap's JSONContent; the sanitizer guarantees the shape
      content: safeDoc as any,
      extensions: documentExtensions(),
    })
  } catch (error) {
    console.error('renderDoc failed:', error)
    return ''
  }
}
